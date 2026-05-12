"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  CircleStop,
  Edit3,
  Loader2,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  PanelLeft,
  Plus,
  Send,
  Trash2,
  X,
} from "lucide-react";

type AuthUser = {
  id: string;
  username: string;
  displayName: string;
};

type WebChatRoom = {
  id: string;
  title: string;
  agent_session_id: string;
  status: "active" | "ended" | "deleted";
  forked_from_room_id: string | null;
  forked_from_message_id: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  deleted_at: string | null;
};

type WebChatMessage = {
  id: string;
  room_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  edited_from_message_id: string | null;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
};

type SseMessage = {
  event: string;
  data: unknown;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: {
        transcript: string;
      };
    };
  };
};

type JsonResult<T> = {
  ok?: boolean;
  error?: string;
} & T;

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function getSpeechRecognitionConstructor() {
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
}

function parseSseBlock(block: string): SseMessage | null {
  const lines = block.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (!dataLines.length) {
    return null;
  }

  const dataText = dataLines.join("\n");

  try {
    return {
      event,
      data: JSON.parse(dataText),
    };
  } catch {
    return {
      event,
      data: dataText,
    };
  }
}

function dataRecord(data: unknown) {
  return data && typeof data === "object" ? (data as Record<string, unknown>) : {};
}

async function parseJsonResponse<T>(response: Response) {
  const result = (await response.json().catch(() => null)) as JsonResult<T> | null;

  if (!response.ok) {
    throw new Error(result?.error || "ดำเนินการไม่สำเร็จ");
  }

  return result as JsonResult<T>;
}

function formatRoomTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function shortenTitle(title: string) {
  return title.length > 46 ? `${title.slice(0, 46)}...` : title;
}

export function AuthenticatedChatModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [authLoading, setAuthLoading] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [rooms, setRooms] = useState<WebChatRoom[]>([]);
  const [currentRoom, setCurrentRoom] = useState<WebChatRoom | null>(null);
  const [messages, setMessages] = useState<WebChatMessage[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState("");
  const [editingMessage, setEditingMessage] = useState<WebChatMessage | null>(null);
  const [deletePrompt, setDeletePrompt] = useState<{
    oldRoomId: string;
    oldRoomTitle: string;
  } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentRoomIdRef = useRef<string | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");

  useEffect(() => {
    currentRoomIdRef.current = currentRoom?.id ?? null;
  }, [currentRoom?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSpeechSupported(Boolean(getSpeechRecognitionConstructor()));
    }, 0);

    return () => {
      window.clearTimeout(timer);
      recognitionRef.current?.abort();
    };
  }, []);

  const loadRoom = useCallback(async (roomId: string) => {
    setError("");
    const response = await fetch(`/api/chat/rooms/${roomId}`);
    const result = await parseJsonResponse<{ room: WebChatRoom; messages: WebChatMessage[] }>(response);

    setCurrentRoom(result.room);
    setMessages(result.messages);
    setEditingMessage(null);
    setDraft("");
  }, []);

  const loadRooms = useCallback(
    async (selectFirstRoom = false) => {
      setRoomsLoading(true);

      try {
        const response = await fetch("/api/chat/rooms");
        const result = await parseJsonResponse<{ rooms: WebChatRoom[] }>(response);

        setRooms(result.rooms);

        if (selectFirstRoom && result.rooms.length > 0) {
          await loadRoom(result.rooms[0].id);
        }
      } finally {
        setRoomsLoading(false);
      }
    },
    [loadRoom],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    let active = true;

    async function loadAuth() {
      setAuthLoading(true);
      setAuthError("");

      try {
        const response = await fetch("/api/auth/me");
        const result = await parseJsonResponse<{ user: AuthUser | null }>(response);

        if (!active) {
          return;
        }

        setUser(result.user ?? null);

        if (result.user) {
          await loadRooms(true);
        }
      } catch (loadError) {
        if (active) {
          setAuthError(loadError instanceof Error ? loadError.message : "ตรวจสอบสถานะเข้าสู่ระบบไม่สำเร็จ");
        }
      } finally {
        if (active) {
          setAuthLoading(false);
        }
      }
    }

    void loadAuth();

    return () => {
      active = false;
    };
  }, [loadRooms, open]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, currentRoom?.id]);

  async function createRoom() {
    const response = await fetch("/api/chat/rooms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const result = await parseJsonResponse<{ room: WebChatRoom; messages: WebChatMessage[] }>(response);

    setRooms((currentRooms) => [result.room, ...currentRooms.filter((room) => room.id !== result.room.id)]);
    setCurrentRoom(result.room);
    setMessages(result.messages);
    setEditingMessage(null);
    setDraft("");

    return result.room;
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginLoading(true);
    setAuthError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username,
          password,
        }),
      });
      const result = await parseJsonResponse<{ user: AuthUser }>(response);

      setUser(result.user);
      setPassword("");
      await loadRooms(true);
    } catch (loginError) {
      setAuthError(loginError instanceof Error ? loginError.message : "เข้าสู่ระบบไม่สำเร็จ");
    } finally {
      setLoginLoading(false);
    }
  }

  async function handleLogout() {
    abortControllerRef.current?.abort();
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setRooms([]);
    setCurrentRoom(null);
    setMessages([]);
    setDraft("");
    setEditingMessage(null);
  }

  function updateAssistantMessage(messageId: string, textDelta: string) {
    setMessages((currentMessages) =>
      currentMessages.map((message) =>
        message.id === messageId
          ? {
              ...message,
              content: `${message.content}${textDelta}`,
            }
          : message,
      ),
    );
  }

  function optimisticAppend(roomId: string, content: string) {
    const now = new Date().toISOString();
    const assistantMessageId = makeId();

    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: makeId(),
        room_id: roomId,
        role: "user",
        content,
        edited_from_message_id: null,
        created_at: now,
        updated_at: now,
        edited_at: null,
      },
      {
        id: assistantMessageId,
        room_id: roomId,
        role: "assistant",
        content: "",
        edited_from_message_id: null,
        created_at: now,
        updated_at: now,
        edited_at: null,
      },
    ]);

    return assistantMessageId;
  }

  function optimisticReplaceAndAppend(roomId: string, messageId: string, content: string) {
    const now = new Date().toISOString();
    const assistantMessageId = makeId();

    setMessages((currentMessages) => {
      const targetIndex = currentMessages.findIndex((message) => message.id === messageId);
      const keptMessages = targetIndex >= 0 ? currentMessages.slice(0, targetIndex + 1) : currentMessages;

      return [
        ...keptMessages.map((message) =>
          message.id === messageId
            ? {
                ...message,
                content,
                updated_at: now,
                edited_at: now,
              }
            : message,
        ),
        {
          id: assistantMessageId,
          room_id: roomId,
          role: "assistant",
          content: "",
          edited_from_message_id: null,
          created_at: now,
          updated_at: now,
          edited_at: null,
        },
      ];
    });

    return assistantMessageId;
  }

  async function streamRoomMessage(
    content: string,
    roomId: string,
    options: {
      editMessageId?: string;
      includeRoomContext?: boolean;
      optimisticMode: "append" | "replace";
    },
  ) {
    const assistantMessageId =
      options.optimisticMode === "replace" && options.editMessageId
        ? optimisticReplaceAndAppend(roomId, options.editMessageId, content)
        : optimisticAppend(roomId, content);
    const abortController = new AbortController();
    let assistantText = "";

    abortControllerRef.current = abortController;
    setStreaming(true);
    setError("");

    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        signal: abortController.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: content,
          roomId,
          channel: "web",
          editMessageId: options.editMessageId,
          includeRoomContext: options.includeRoomContext === true,
        }),
      });

      if (!response.ok || !response.body) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "เชื่อมต่อผู้ช่วยไม่สำเร็จ");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\n\n/);
        buffer = blocks.pop() ?? "";

        for (const block of blocks) {
          const event = parseSseBlock(block);

          if (!event) {
            continue;
          }

          const data = dataRecord(event.data);

          if (event.event === "text_delta" && typeof data.text === "string") {
            assistantText += data.text;
            updateAssistantMessage(assistantMessageId, data.text);
          }

          if (event.event === "error" && typeof data.message === "string") {
            throw new Error(data.message);
          }
        }
      }

      if (!assistantText.trim()) {
        updateAssistantMessage(assistantMessageId, "ขออภัยค่ะ ยังไม่มีคำตอบจากผู้ช่วยในรอบนี้");
      }

      if (currentRoomIdRef.current === roomId) {
        await loadRoom(roomId);
      }

      await loadRooms(false);
    } catch (streamError) {
      const wasCanceled =
        streamError instanceof DOMException ||
        (streamError instanceof Error && streamError.name === "AbortError");

      if (wasCanceled) {
        setError("");
        return;
      }

      const message = streamError instanceof Error ? streamError.message : "เชื่อมต่อผู้ช่วยไม่สำเร็จ";
      setError(message);
      updateAssistantMessage(assistantMessageId, `ขออภัยค่ะ ${message}`);
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }

      setStreaming(false);
    }
  }

  async function sendMessage(explicitText?: string) {
    const messageText = (explicitText ?? draft).trim();

    if (!messageText || streaming) {
      return;
    }

    setDraft("");

    if (editingMessage && currentRoom) {
      const userMessages = messages.filter((message) => message.role === "user");
      const latestUserMessage = userMessages[userMessages.length - 1];
      const isLatestUserMessage = latestUserMessage?.id === editingMessage.id;

      if (isLatestUserMessage) {
        const editedId = editingMessage.id;
        setEditingMessage(null);
        await streamRoomMessage(messageText, currentRoom.id, {
          editMessageId: editedId,
          includeRoomContext: true,
          optimisticMode: "replace",
        });
        return;
      }

      try {
        const oldRoom = currentRoom;
        const response = await fetch(`/api/chat/rooms/${currentRoom.id}/fork`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messageId: editingMessage.id,
            content: messageText,
          }),
        });
        const result = await parseJsonResponse<{ room: WebChatRoom; messages: WebChatMessage[] }>(response);

        setDeletePrompt({
          oldRoomId: oldRoom.id,
          oldRoomTitle: oldRoom.title,
        });
        setCurrentRoom(result.room);
        setMessages(result.messages);
        setEditingMessage(null);
        setRooms((currentRooms) => [result.room, ...currentRooms.filter((room) => room.id !== result.room.id)]);
        await streamRoomMessage(messageText, result.room.id, {
          includeRoomContext: true,
          optimisticMode: "append",
        });
      } catch (forkError) {
        setError(forkError instanceof Error ? forkError.message : "สร้างห้องแชทใหม่ไม่สำเร็จ");
      }

      return;
    }

    const room = currentRoom ?? (await createRoom());

    await streamRoomMessage(messageText, room.id, {
      optimisticMode: "append",
    });
  }

  function cancelActiveResponse() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStreaming(false);
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    void sendMessage();
  }

  function beginEdit(message: WebChatMessage) {
    setEditingMessage(message);
    setDraft(message.content);
    setError("");
  }

  function cancelEdit() {
    setEditingMessage(null);
    setDraft("");
  }

  function startVoiceInput() {
    const Recognition = getSpeechRecognitionConstructor();

    if (!Recognition || streaming) {
      setError("เบราว์เซอร์นี้ยังไม่รองรับการรับเสียง");
      return;
    }

    transcriptRef.current = "";
    setDraft("");
    setError("");
    setListening(true);

    const recognition = new Recognition();
    recognition.lang = "th-TH";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";

        if (result.isFinal) {
          finalText += transcript;
        } else {
          interimText += transcript;
        }
      }

      if (finalText) {
        transcriptRef.current = `${transcriptRef.current} ${finalText}`.trim();
      }

      setDraft(`${transcriptRef.current} ${interimText}`.trim());
    };

    recognition.onerror = () => {
      setListening(false);
      setError("รับเสียงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    };

    recognition.onend = () => {
      setListening(false);
      const finalTranscript = transcriptRef.current.trim();

      if (finalTranscript) {
        void sendMessage(finalTranscript);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopVoiceInput() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  async function deleteOldRoom() {
    if (!deletePrompt) {
      return;
    }

    try {
      await fetch(`/api/chat/rooms/${deletePrompt.oldRoomId}`, {
        method: "DELETE",
      });
      setRooms((currentRooms) => currentRooms.filter((room) => room.id !== deletePrompt.oldRoomId));
      setDeletePrompt(null);
    } catch {
      setDeletePrompt(null);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-md">
      <section className="relative flex h-[min(90vh,780px)] w-[min(1180px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-lg border border-white/70 bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-950 text-white">
              <Bot className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-slate-950">AgentCare Member Chat</h2>
              <p className="truncate text-xs text-slate-500">
                {user ? `${user.displayName} · ${currentRoom?.title ?? "บทสนทนา"}` : "เข้าสู่ระบบ"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {user ? (
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-teal-500"
                aria-label="ออกจากระบบ"
                title="ออกจากระบบ"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-teal-500"
              aria-label="ปิด"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </header>

        {authLoading ? (
          <div className="flex flex-1 items-center justify-center text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
            กำลังโหลด
          </div>
        ) : !user ? (
          <div className="flex flex-1 items-center justify-center bg-slate-50 px-4">
            <form
              onSubmit={handleLogin}
              className="w-full max-w-[420px] rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
            >
              <div className="mb-5">
                <h3 className="text-xl font-semibold text-slate-950">เข้าสู่ระบบสมาชิก</h3>
                <p className="mt-1 text-sm text-slate-500">เปิดประวัติและแชทขนาดใหญ่</p>
              </div>
              <label className="mb-3 block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Username</span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  autoComplete="username"
                  required
                />
              </label>
              <label className="mb-4 block">
                <span className="mb-1.5 block text-sm font-medium text-slate-700">Password</span>
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  className="h-11 w-full rounded-md border border-slate-300 px-3 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                  autoComplete="current-password"
                  required
                />
              </label>
              {authError ? (
                <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {authError}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={loginLoading}
                className="flex h-11 w-full items-center justify-center rounded-md bg-teal-600 px-4 text-sm font-semibold text-white transition hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loginLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                เข้าสู่ระบบ
              </button>
            </form>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-rows-[170px_1fr] bg-white md:grid-cols-[280px_1fr] md:grid-rows-1">
            <aside className="min-h-0 border-b border-slate-200 bg-slate-50 md:border-b-0 md:border-r">
              <div className="flex items-center justify-between px-3 py-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <PanelLeft className="h-4 w-4" aria-hidden="true" />
                  ประวัติ
                </div>
                <button
                  type="button"
                  onClick={() => void createRoom()}
                  className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-teal-700 shadow-sm ring-1 ring-slate-200 transition hover:bg-teal-50 focus:outline-none focus:ring-2 focus:ring-teal-500"
                  aria-label="บทสนทนาใหม่"
                  title="บทสนทนาใหม่"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
              <div className="h-[calc(100%-3.5rem)] overflow-y-auto px-2 pb-3">
                {roomsLoading ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    กำลังโหลด
                  </div>
                ) : rooms.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => void createRoom()}
                    className="flex w-full items-center gap-2 rounded-md border border-dashed border-slate-300 bg-white px-3 py-3 text-left text-sm text-slate-600 transition hover:border-teal-300 hover:text-teal-700"
                  >
                    <MessageSquare className="h-4 w-4" aria-hidden="true" />
                    บทสนทนาใหม่
                  </button>
                ) : (
                  rooms.map((room) => (
                    <button
                      key={room.id}
                      type="button"
                      onClick={() => void loadRoom(room.id)}
                      className={[
                        "mb-1.5 block w-full rounded-md px-3 py-2.5 text-left transition focus:outline-none focus:ring-2 focus:ring-teal-500",
                        room.id === currentRoom?.id
                          ? "bg-teal-600 text-white shadow-sm"
                          : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-teal-50 hover:text-teal-800",
                      ].join(" ")}
                    >
                      <span className="block truncate text-sm font-medium">{shortenTitle(room.title)}</span>
                      <span
                        className={[
                          "mt-1 block text-xs",
                          room.id === currentRoom?.id ? "text-teal-50" : "text-slate-400",
                        ].join(" ")}
                      >
                        {formatRoomTime(room.last_message_at)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </aside>

            <main className="flex min-h-0 flex-col bg-white">
              <div className="flex-1 overflow-y-auto bg-slate-50 px-3 py-4 md:px-6">
                {!currentRoom ? (
                  <div className="flex h-full items-center justify-center">
                    <button
                      type="button"
                      onClick={() => void createRoom()}
                      className="flex items-center gap-2 rounded-md bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      บทสนทนาใหม่
                    </button>
                  </div>
                ) : (
                  <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
                    {messages.length === 0 ? (
                      <div className="rounded-lg border border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">
                        เริ่มถามข้อมูลสมาชิกได้เลย
                      </div>
                    ) : null}
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        className={[
                          "group flex",
                          message.role === "user" ? "justify-end" : "justify-start",
                        ].join(" ")}
                      >
                        <div
                          className={[
                            "max-w-[82%] rounded-lg px-3.5 py-2.5 text-sm leading-6 shadow-sm",
                            message.role === "user"
                              ? "bg-teal-600 text-white"
                              : "border border-slate-200 bg-white text-slate-800",
                          ].join(" ")}
                        >
                          <p className="whitespace-pre-wrap break-words">{message.content || "กำลังตอบ..."}</p>
                          {message.role === "user" ? (
                            <div className="mt-1 flex justify-end">
                              <button
                                type="button"
                                onClick={() => beginEdit(message)}
                                disabled={streaming}
                                className="flex h-6 w-6 items-center justify-center rounded text-white/75 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/60 disabled:cursor-not-allowed disabled:opacity-50"
                                aria-label="แก้ไขข้อความ"
                                title="แก้ไขข้อความ"
                              >
                                <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ))}
                    <div ref={messageEndRef} />
                  </div>
                )}
              </div>

              {error ? (
                <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
              ) : null}

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendMessage();
                }}
                className="border-t border-slate-200 bg-white px-3 py-3 md:px-4"
              >
                {editingMessage ? (
                  <div className="mb-2 flex items-center justify-between rounded-md bg-teal-50 px-3 py-2 text-sm text-teal-800">
                    <span className="truncate">กำลังแก้ไข: {shortenTitle(editingMessage.content)}</span>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="ml-3 flex h-7 w-7 items-center justify-center rounded-md hover:bg-teal-100"
                      aria-label="ยกเลิกแก้ไข"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                ) : null}
                <div className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={handleDraftKeyDown}
                    rows={1}
                    placeholder="ถามเรื่องข้อมูลสมาชิก..."
                    disabled={streaming || !currentRoom}
                    className="max-h-28 min-h-11 flex-1 resize-none rounded-md border border-slate-300 px-3 py-2.5 text-sm leading-6 outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:bg-slate-100 disabled:text-slate-400"
                  />
                  <button
                    type="button"
                    onClick={listening ? stopVoiceInput : startVoiceInput}
                    disabled={!speechSupported || streaming || !currentRoom}
                    className={[
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-md border transition focus:outline-none focus:ring-2 focus:ring-teal-500",
                      listening
                        ? "border-teal-500 bg-teal-50 text-teal-700"
                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
                    ].join(" ")}
                    aria-label={listening ? "หยุดรับเสียง" : "รับเสียง"}
                    title={listening ? "หยุดรับเสียง" : "รับเสียง"}
                  >
                    {listening ? <MicOff className="h-4 w-4" aria-hidden="true" /> : <Mic className="h-4 w-4" />}
                  </button>
                  {streaming ? (
                    <button
                      type="button"
                      onClick={cancelActiveResponse}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-slate-800 text-white transition hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-700"
                      aria-label="ยกเลิก"
                      title="ยกเลิก"
                    >
                      <CircleStop className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!draft.trim() || !currentRoom}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-teal-600 text-white transition hover:bg-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:cursor-not-allowed disabled:bg-slate-300"
                      aria-label="ส่งข้อความ"
                    >
                      <Send className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </form>
            </main>
          </div>
        )}

        {deletePrompt ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/30 px-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-red-50 text-red-600">
                <Trash2 className="h-5 w-5" aria-hidden="true" />
              </div>
              <h3 className="text-base font-semibold text-slate-950">ลบห้องแชทเก่าหรือไม่</h3>
              <p className="mt-1 text-sm text-slate-500">{shortenTitle(deletePrompt.oldRoomTitle)}</p>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setDeletePrompt(null)}
                  className="h-10 rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  เก็บไว้
                </button>
                <button
                  type="button"
                  onClick={() => void deleteOldRoom()}
                  className="h-10 rounded-md bg-red-600 px-3 text-sm font-semibold text-white transition hover:bg-red-700"
                >
                  ลบห้องเก่า
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
