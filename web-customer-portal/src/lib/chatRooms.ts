import { createChatSession } from "@/lib/sessions";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type WebChatRoom = {
  id: string;
  user_id: string;
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

export type WebChatMessage = {
  id: string;
  room_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  edited_from_message_id: string | null;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
};

function roomError(action: string, error: unknown) {
  const details =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message)
        : String(error);

  return new Error(`Unable to ${action}. Details: ${details}`);
}

function makeTitle(message: string) {
  const title = message.trim().replace(/\s+/g, " ").slice(0, 48);

  return title || "บทสนทนาใหม่";
}

export async function createWebChatRoom(input: {
  userId: string;
  actorId: string;
  title?: string;
  forkedFromRoomId?: string;
  forkedFromMessageId?: string;
}) {
  const session = await createChatSession("web", input.actorId);
  const { data, error } = await getSupabaseAdmin()
    .from("web_chat_rooms")
    .insert({
      user_id: input.userId,
      title: input.title || "บทสนทนาใหม่",
      agent_session_id: session.agent_session_id,
      forked_from_room_id: input.forkedFromRoomId ?? null,
      forked_from_message_id: input.forkedFromMessageId ?? null,
    })
    .select("*")
    .single<WebChatRoom>();

  if (error || !data) {
    throw roomError("create web chat room", error ?? new Error("No room returned"));
  }

  return data;
}

export async function listWebChatRooms(userId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("web_chat_rooms")
    .select("*")
    .eq("user_id", userId)
    .neq("status", "deleted")
    .order("last_message_at", { ascending: false })
    .returns<WebChatRoom[]>();

  if (error) {
    throw roomError("list web chat rooms", error);
  }

  return data ?? [];
}

export async function getWebChatRoom(userId: string, roomId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("web_chat_rooms")
    .select("*")
    .eq("user_id", userId)
    .eq("id", roomId)
    .neq("status", "deleted")
    .maybeSingle<WebChatRoom>();

  if (error) {
    throw roomError("read web chat room", error);
  }

  return data;
}

export async function listWebChatMessages(roomId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("web_chat_messages")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .returns<WebChatMessage[]>();

  if (error) {
    throw roomError("list web chat messages", error);
  }

  return data ?? [];
}

export async function insertWebChatMessage(input: {
  roomId: string;
  role: WebChatMessage["role"];
  content: string;
  editedFromMessageId?: string;
}) {
  const now = new Date().toISOString();
  const roomUpdate: {
    last_message_at: string;
    updated_at: string;
    title?: string;
  } = {
    last_message_at: now,
    updated_at: now,
  };

  if (input.role === "user") {
    roomUpdate.title = makeTitle(input.content);
  }

  const { data, error } = await getSupabaseAdmin()
    .from("web_chat_messages")
    .insert({
      room_id: input.roomId,
      role: input.role,
      content: input.content,
      edited_from_message_id: input.editedFromMessageId ?? null,
    })
    .select("*")
    .single<WebChatMessage>();

  if (error || !data) {
    throw roomError("insert web chat message", error ?? new Error("No message returned"));
  }

  await getSupabaseAdmin()
    .from("web_chat_rooms")
    .update(roomUpdate)
    .eq("id", input.roomId)
    .eq("title", "บทสนทนาใหม่");

  await getSupabaseAdmin()
    .from("web_chat_rooms")
    .update({
      last_message_at: now,
      updated_at: now,
    })
    .eq("id", input.roomId);

  return data;
}

export async function replaceUserMessageAndDeleteFollowing(input: {
  roomId: string;
  messageId: string;
  content: string;
}) {
  const messages = await listWebChatMessages(input.roomId);
  const target = messages.find((message) => message.id === input.messageId && message.role === "user");

  if (!target) {
    throw new Error("ไม่พบข้อความที่ต้องการแก้ไข");
  }

  const followingMessageIds = messages
    .filter((message) => new Date(message.created_at).getTime() > new Date(target.created_at).getTime())
    .map((message) => message.id);

  if (followingMessageIds.length > 0) {
    const { error: deleteError } = await getSupabaseAdmin()
      .from("web_chat_messages")
      .delete()
      .in("id", followingMessageIds);

    if (deleteError) {
      throw roomError("delete following web chat messages", deleteError);
    }
  }

  const { data, error } = await getSupabaseAdmin()
    .from("web_chat_messages")
    .update({
      content: input.content,
      updated_at: new Date().toISOString(),
      edited_at: new Date().toISOString(),
    })
    .eq("id", input.messageId)
    .eq("room_id", input.roomId)
    .eq("role", "user")
    .select("*")
    .single<WebChatMessage>();

  if (error || !data) {
    throw roomError("replace user message", error ?? new Error("No message returned"));
  }

  await getSupabaseAdmin()
    .from("web_chat_rooms")
    .update({
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      title: makeTitle(input.content),
    })
    .eq("id", input.roomId);

  return data;
}

export async function forkWebChatRoom(input: {
  userId: string;
  actorId: string;
  sourceRoomId: string;
  sourceMessageId: string;
  editedContent: string;
}) {
  const sourceRoom = await getWebChatRoom(input.userId, input.sourceRoomId);

  if (!sourceRoom) {
    throw new Error("ไม่พบห้องแชทเดิม");
  }

  const sourceMessages = await listWebChatMessages(sourceRoom.id);
  const sourceMessage = sourceMessages.find(
    (message) => message.id === input.sourceMessageId && message.role === "user",
  );

  if (!sourceMessage) {
    throw new Error("ไม่พบข้อความที่ต้องการแก้ไข");
  }

  const newRoom = await createWebChatRoom({
    userId: input.userId,
    actorId: input.actorId,
    title: makeTitle(input.editedContent),
    forkedFromRoomId: sourceRoom.id,
    forkedFromMessageId: sourceMessage.id,
  });
  const beforeMessages = sourceMessages.filter(
    (message) => new Date(message.created_at).getTime() < new Date(sourceMessage.created_at).getTime(),
  );

  for (const message of beforeMessages) {
    await insertWebChatMessage({
      roomId: newRoom.id,
      role: message.role,
      content: message.content,
    });
  }

  return {
    room: newRoom,
    copiedMessages: beforeMessages,
  };
}

export async function deleteWebChatRoom(userId: string, roomId: string) {
  const now = new Date().toISOString();
  const { error } = await getSupabaseAdmin()
    .from("web_chat_rooms")
    .update({
      status: "deleted",
      deleted_at: now,
      updated_at: now,
    })
    .eq("user_id", userId)
    .eq("id", roomId);

  if (error) {
    throw roomError("delete web chat room", error);
  }
}

export function buildRoomContext(messages: WebChatMessage[]) {
  const lines = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-16)
    .map((message) => `${message.role === "user" ? "ผู้ใช้" : "ผู้ช่วย"}: ${message.content}`);

  if (lines.length === 0) {
    return "";
  }

  return `บริบทบทสนทนาก่อนหน้า:\n${lines.join("\n")}\n\nตอบข้อความล่าสุดต่อจากบริบทนี้เท่านั้น`;
}
