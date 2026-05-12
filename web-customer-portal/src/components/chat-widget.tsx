"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  Bot,
  CircleStop,
  Loader2,
  Maximize2,
  MessageCircle,
  Mic,
  MicOff,
  RefreshCw,
  Send,
  X,
} from "lucide-react";

import { AuthenticatedChatModal } from "@/components/authenticated-chat-modal";

type ChatMessage = {
  id: string;
  role: "assistant" | "user" | "system";
  content: string;
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

const welcomeMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content: "สวัสดีค่ะ สอบถามข้อมูลสมาชิก สิทธิประโยชน์ หรือสถานะบริการได้เลย",
  },
];

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function getClientUserId() {
  const key = "agent-portal-web-user-id";
  const existingId = window.localStorage.getItem(key);

  if (existingId) {
    return existingId;
  }

  const nextId = makeId();
  window.localStorage.setItem(key, nextId);

  return nextId;
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

export function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [expandedOpen, setExpandedOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>(welcomeMessages);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const canceledRef = useRef(false);
  const conversationVersionRef = useRef(0);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const transcriptRef = useRef("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSpeechSupported(Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));
    }, 0);

    return () => {
      window.clearTimeout(timer);
      recognitionRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, open]);

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

  function appendSystemMessage(content: string) {
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: makeId(),
        role: "system",
        content,
      },
    ]);
  }

  function removeEmptyAssistantMessage(messageId: string | null) {
    if (!messageId) {
      return;
    }

    setMessages((currentMessages) =>
      currentMessages.filter((message) => message.id !== messageId || message.content.trim()),
    );
  }

  async function sendMessage(explicitText?: string) {
    const messageText = (explicitText ?? draft).trim();

    if (!messageText || loading || resetting) {
      return;
    }

    setDraft("");
    setError("");
    setLoading(true);
    canceledRef.current = false;

    const userMessageId = makeId();
    const assistantMessageId = makeId();
    const requestVersion = conversationVersionRef.current;
    const abortController = new AbortController();
    let assistantText = "";

    activeAssistantMessageIdRef.current = assistantMessageId;
    abortControllerRef.current = abortController;

    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: userMessageId,
        role: "user",
        content: messageText,
      },
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
      },
    ]);

    try {
      const response = await fetch("/api/agent/chat", {
        method: "POST",
        signal: abortController.signal,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: messageText,
          sessionId,
          channel: "web",
          userId: getClientUserId(),
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

        if (requestVersion !== conversationVersionRef.current) {
          return;
        }

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

          if (event.event === "session" && typeof data.sessionId === "string") {
            setSessionId(data.sessionId);
          }

          if (event.event === "text_delta" && typeof data.text === "string") {
            assistantText += data.text;
            updateAssistantMessage(assistantMessageId, data.text);
          }

          if (event.event === "session_state") {
            if (data.session_ended === true) {
              setSessionId(null);
            } else if (typeof data.session_id === "string") {
              setSessionId(data.session_id);
            }
          }

          if (event.event === "done" && data.sessionEnded === true) {
            setSessionId(null);
          }

          if (event.event === "error" && typeof data.message === "string") {
            throw new Error(data.message);
          }
        }
      }

      if (!assistantText.trim()) {
        updateAssistantMessage(assistantMessageId, "ขออภัยค่ะ ยังไม่มีคำตอบจากผู้ช่วยในรอบนี้");
      }
    } catch (chatError) {
      const wasCanceled =
        canceledRef.current ||
        (chatError instanceof DOMException && chatError.name === "AbortError") ||
        (chatError instanceof Error && chatError.name === "AbortError");

      if (requestVersion !== conversationVersionRef.current) {
        return;
      }

      if (wasCanceled) {
        setError("");
        removeEmptyAssistantMessage(assistantMessageId);
        appendSystemMessage("ยกเลิกคำตอบแล้ว คุณพิมพ์คำถามใหม่ต่อในบทสนทนาเดิมได้");
        return;
      }

      const message = chatError instanceof Error ? chatError.message : "เชื่อมต่อผู้ช่วยไม่สำเร็จ";
      setError(message);
      updateAssistantMessage(assistantMessageId, `ขออภัยค่ะ ${message}`);
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
        activeAssistantMessageIdRef.current = null;
      }

      if (requestVersion === conversationVersionRef.current) {
        setLoading(false);
        canceledRef.current = false;
      }
    }
  }

  function cancelActiveResponse() {
    if (!loading) {
      return;
    }

    conversationVersionRef.current += 1;
    canceledRef.current = true;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setLoading(false);
    setError("");
    removeEmptyAssistantMessage(activeAssistantMessageIdRef.current);
    activeAssistantMessageIdRef.current = null;
    appendSystemMessage("ยกเลิกคำตอบแล้ว คุณพิมพ์คำถามใหม่ต่อในบทสนทนาเดิมได้");
  }

  async function resetConversation() {
    const sessionIdToReset = sessionId;

    conversationVersionRef.current += 1;
    canceledRef.current = true;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    activeAssistantMessageIdRef.current = null;
    setResetting(true);
    setLoading(false);
    setError("");
    setDraft("");
    setSessionId(null);
    setMessages(welcomeMessages);

    try {
      const response = await fetch("/api/agent/session/reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: sessionIdToReset,
          channel: "web",
          userId: getClientUserId(),
        }),
      });
      const result = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(result?.error || "รีเฟรชบทสนทนาไม่สำเร็จ");
      }
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "รีเฟรชบทสนทนาไม่สำเร็จ");
    } finally {
      setResetting(false);
      canceledRef.current = false;
    }
  }

  function startVoiceInput() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!Recognition || loading) {
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    void sendMessage();
  }

  return (
    <>
      <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3 md:bottom-5 md:right-5">
        {open ? (
          <section className="flex h-[min(560px,calc(100vh-6.5rem))] w-[min(390px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-slate-200 bg-slate-950 px-3.5 py-3 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-teal-500">
                <Bot className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">ผู้ช่วยสมาชิก</h2>
                <p className="text-xs text-slate-300">AgentCore MyAgent</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void resetConversation()}
                disabled={resetting}
                title="เริ่มบทสนทนาใหม่"
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/50 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="เริ่มบทสนทนาใหม่"
              >
                <RefreshCw
                  className={["h-4 w-4", resetting ? "animate-spin" : ""].join(" ")}
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                onClick={() => setExpandedOpen(true)}
                title="ขยายแชท"
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/50"
                aria-label="ขยายแชท"
              >
                <Maximize2 className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-slate-200 transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/50"
                aria-label="ปิดแชท"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3 py-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={[
                  "flex",
                  message.role === "system"
                    ? "justify-center"
                    : message.role === "user"
                      ? "justify-end"
                      : "justify-start",
                ].join(" ")}
              >
                <div
                  className={[
                    "max-w-[84%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-6 shadow-sm",
                    message.role === "system"
                      ? "bg-transparent px-2 py-1 text-center text-xs text-slate-500 shadow-none"
                      : message.role === "user"
                        ? "bg-teal-600 text-white"
                        : "border border-slate-200 bg-white text-slate-800",
                  ].join(" ")}
                >
                  {message.content || (
                    <span className="inline-flex items-center gap-2 text-slate-500">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      กำลังตอบ
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div ref={messageEndRef} />
          </div>

          {error ? (
            <div className="border-t border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700">
              {error}
            </div>
          ) : null}

          <form onSubmit={handleSubmit} className="border-t border-slate-200 bg-white p-2.5">
            <div className="flex items-center gap-2">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleDraftKeyDown}
                disabled={loading}
                rows={1}
                placeholder="ถามเรื่องข้อมูลสมาชิก..."
                className="h-10 max-h-24 flex-1 resize-none rounded-md border border-slate-200 px-3 py-2 text-sm leading-6 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-100 disabled:bg-slate-100"
              />
              <button
                type="button"
                onClick={listening ? stopVoiceInput : startVoiceInput}
                disabled={!speechSupported || loading}
                title={speechSupported ? "รับเสียง" : "เบราว์เซอร์ไม่รองรับเสียง"}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-100 disabled:cursor-not-allowed disabled:opacity-45"
                aria-label={listening ? "หยุดรับเสียง" : "รับเสียง"}
              >
                {listening ? (
                  <MicOff className="h-4 w-4 text-red-600" aria-hidden="true" />
                ) : (
                  <Mic className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
              <button
                type={loading ? "button" : "submit"}
                onClick={loading ? cancelActiveResponse : undefined}
                disabled={resetting || (!loading && !draft.trim())}
                title={loading ? "ยกเลิกคำตอบ" : "ส่งข้อความ"}
                className={[
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-white transition focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-400",
                  loading
                    ? "bg-red-600 hover:bg-red-500 focus:ring-red-200"
                    : "bg-slate-950 hover:bg-slate-800 focus:ring-slate-300",
                ].join(" ")}
                aria-label={loading ? "ยกเลิกคำตอบ" : "ส่งข้อความ"}
              >
                {loading ? (
                  <CircleStop className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Send className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </form>
          </section>
        ) : null}

        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-4 py-3 text-sm font-semibold text-white shadow-xl transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300"
          aria-label="เปิดแชท"
        >
          <MessageCircle className="h-5 w-5" aria-hidden="true" />
          ถามผู้ช่วย
        </button>
      </div>
      <AuthenticatedChatModal open={expandedOpen} onClose={() => setExpandedOpen(false)} />
    </>
  );
}
