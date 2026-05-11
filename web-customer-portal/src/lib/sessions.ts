import { randomUUID } from "crypto";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type ChatChannel = "web" | "line";
export type ChatSessionStatus = "active" | "ended" | "expired";
export type ChatTurnStatus = "idle" | "debouncing" | "processing";
export type LineWebhookEventStatus = "received" | "processing" | "processed" | "dropped";

export type ChatSession = {
  id: string;
  channel: ChatChannel;
  actor_id: string;
  status: ChatSessionStatus;
  turn_status?: ChatTurnStatus;
  locked_until?: string | null;
  agent_session_id: string;
  last_activity_at: string;
  expires_at: string;
  created_at: string;
  ended_at: string | null;
};

export type LineWebhookEventRecord = {
  line_message_id: string;
  line_user_id: string;
  chat_session_id: string | null;
  agent_session_id: string;
  reply_token: string;
  message_text: string;
  status: LineWebhookEventStatus;
  created_at: string;
  processed_at: string | null;
};

type GetOrCreateSessionInput = {
  channel: ChatChannel;
  actorId: string;
  requestedAgentSessionId?: string;
};

type EndActiveSessionsInput = {
  channel: ChatChannel;
  actorId: string;
  requestedAgentSessionId?: string;
};

type RegisterLineTextMessageInput = {
  lineMessageId: string;
  lineUserId: string;
  chatSessionId: string;
  agentSessionId: string;
  replyToken: string;
  messageText: string;
};

const DEFAULT_SESSION_TTL_SECONDS = 3600;
const LINE_DEBOUNCE_LOCK_SECONDS = 70;
const LINE_PROCESSING_LOCK_SECONDS = 600;

export function getSessionTtlSeconds() {
  const rawValue = Number(process.env.SESSION_TTL_SECONDS);

  if (Number.isFinite(rawValue) && rawValue > 0) {
    return rawValue;
  }

  return DEFAULT_SESSION_TTL_SECONDS;
}

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1000);
}

function isFresh(session: ChatSession) {
  return session.status === "active" && new Date(session.expires_at).getTime() > Date.now();
}

function expiresAtIso(ttlSeconds = getSessionTtlSeconds()) {
  return addSeconds(new Date(), ttlSeconds).toISOString();
}

function lockExpiresAtIso(seconds: number) {
  return addSeconds(new Date(), seconds).toISOString();
}

function sessionStoreError(action: string, error: unknown) {
  const details = describeError(error);

  return new Error(
    `Unable to ${action}. Check SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and run the chat_sessions migration first. Details: ${details}`,
  );
}

function describeError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const possibleError = error as {
      code?: string;
      message?: string;
      details?: string;
      hint?: string;
    };
    const parts = [
      possibleError.message,
      possibleError.code ? `code=${possibleError.code}` : "",
      possibleError.details ? `details=${possibleError.details}` : "",
      possibleError.hint ? `hint=${possibleError.hint}` : "",
    ].filter(Boolean);

    if (parts.length > 0) {
      return parts.join("; ");
    }

    return JSON.stringify(error);
  }

  return String(error);
}

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code?: unknown }).code);
  }

  return "";
}

export async function touchChatSession(agentSessionId: string, ttlSeconds = getSessionTtlSeconds()) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("chat_sessions")
    .update({
      last_activity_at: new Date().toISOString(),
      expires_at: expiresAtIso(ttlSeconds),
    })
    .eq("agent_session_id", agentSessionId)
    .eq("status", "active");

  if (error) {
    throw sessionStoreError("extend chat session", error);
  }
}

export async function markChatSessionEnded(
  agentSessionId: string,
  status: Extract<ChatSessionStatus, "ended" | "expired"> = "ended",
) {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("chat_sessions")
    .update({
      status,
      ended_at: status === "ended" ? now : null,
      expires_at: now,
      last_activity_at: now,
    })
    .eq("agent_session_id", agentSessionId)
    .eq("status", "active");

  if (error) {
    throw sessionStoreError(`mark chat session ${status}`, error);
  }
}

export async function endActiveChatSessionsForActor(input: EndActiveSessionsInput) {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("chat_sessions")
    .select("*")
    .eq("channel", input.channel)
    .eq("actor_id", input.actorId)
    .eq("status", "active");

  if (input.requestedAgentSessionId) {
    query = query.eq("agent_session_id", input.requestedAgentSessionId);
  }

  const { data, error } = await query.returns<ChatSession[]>();

  if (error) {
    throw sessionStoreError("read active chat sessions for reset", error);
  }

  const sessions = data ?? [];

  if (sessions.length === 0) {
    return [];
  }

  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("chat_sessions")
    .update({
      status: "ended",
      ended_at: now,
      expires_at: now,
      last_activity_at: now,
    })
    .in(
      "agent_session_id",
      sessions.map((session) => session.agent_session_id),
    );

  if (updateError) {
    throw sessionStoreError("end active chat sessions for reset", updateError);
  }

  return sessions;
}

export async function registerLineTextMessageEvent(input: RegisterLineTextMessageInput) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("line_webhook_events")
    .insert({
      line_message_id: input.lineMessageId,
      line_user_id: input.lineUserId,
      chat_session_id: input.chatSessionId,
      agent_session_id: input.agentSessionId,
      reply_token: input.replyToken,
      message_text: input.messageText,
      status: "received",
    })
    .select("*")
    .single<LineWebhookEventRecord>();

  if (error) {
    if (errorCode(error) === "23505") {
      return {
        inserted: false,
        event: null,
      };
    }

    throw sessionStoreError("register LINE message event", error);
  }

  return {
    inserted: true,
    event: data,
  };
}

export async function readChatSessionByAgentSessionId(agentSessionId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("agent_session_id", agentSessionId)
    .maybeSingle<ChatSession>();

  if (error) {
    throw sessionStoreError("read chat session by agent session id", error);
  }

  return data;
}

export async function startLineDebounceTurn(agentSessionId: string) {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("chat_sessions")
    .update({
      turn_status: "debouncing",
      locked_until: lockExpiresAtIso(LINE_DEBOUNCE_LOCK_SECONDS),
      last_activity_at: now,
      expires_at: expiresAtIso(),
    })
    .eq("agent_session_id", agentSessionId)
    .eq("status", "active")
    .or(`turn_status.eq.idle,locked_until.lt.${now}`)
    .select("*")
    .maybeSingle<ChatSession>();

  if (error) {
    throw sessionStoreError("start LINE debounce turn", error);
  }

  return data;
}

export async function markLineTurnProcessing(agentSessionId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("chat_sessions")
    .update({
      turn_status: "processing",
      locked_until: lockExpiresAtIso(LINE_PROCESSING_LOCK_SECONDS),
      last_activity_at: new Date().toISOString(),
      expires_at: expiresAtIso(),
    })
    .eq("agent_session_id", agentSessionId)
    .eq("status", "active")
    .eq("turn_status", "debouncing")
    .select("*")
    .maybeSingle<ChatSession>();

  if (error) {
    throw sessionStoreError("mark LINE turn processing", error);
  }

  return data;
}

export async function finishLineTurn(agentSessionId: string) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("chat_sessions")
    .update({
      turn_status: "idle",
      locked_until: null,
      last_activity_at: new Date().toISOString(),
      expires_at: expiresAtIso(),
    })
    .eq("agent_session_id", agentSessionId)
    .eq("status", "active");

  if (error) {
    throw sessionStoreError("finish LINE turn", error);
  }
}

export async function markLineMessageEventDropped(lineMessageId: string) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("line_webhook_events")
    .update({
      status: "dropped",
      processed_at: new Date().toISOString(),
    })
    .eq("line_message_id", lineMessageId)
    .eq("status", "received");

  if (error) {
    throw sessionStoreError("mark LINE message event dropped", error);
  }
}

export async function claimLineDebouncedTextEvents(input: {
  chatSessionId: string;
  lineUserId: string;
  cutoffIso: string;
}) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("line_webhook_events")
    .select("*")
    .eq("chat_session_id", input.chatSessionId)
    .eq("line_user_id", input.lineUserId)
    .eq("status", "received")
    .lte("created_at", input.cutoffIso)
    .order("created_at", { ascending: true })
    .returns<LineWebhookEventRecord[]>();

  if (error) {
    throw sessionStoreError("claim LINE debounced text events", error);
  }

  const events = data ?? [];

  if (events.length === 0) {
    return [];
  }

  const { error: updateError } = await supabase
    .from("line_webhook_events")
    .update({
      status: "processing",
    })
    .in(
      "line_message_id",
      events.map((event) => event.line_message_id),
    )
    .eq("status", "received");

  if (updateError) {
    throw sessionStoreError("mark LINE debounced text events processing", updateError);
  }

  return events;
}

export async function markLineMessageEventsProcessed(lineMessageIds: string[]) {
  if (lineMessageIds.length === 0) {
    return;
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase
    .from("line_webhook_events")
    .update({
      status: "processed",
      processed_at: new Date().toISOString(),
    })
    .in("line_message_id", lineMessageIds);

  if (error) {
    throw sessionStoreError("mark LINE message events processed", error);
  }
}

async function createChatSession(channel: ChatChannel, actorId: string) {
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("chat_sessions")
    .insert({
      channel,
      actor_id: actorId,
      status: "active",
      agent_session_id: randomUUID(),
      last_activity_at: now,
      expires_at: expiresAtIso(),
    })
    .select("*")
    .single<ChatSession>();

  if (error || !data) {
    throw sessionStoreError("create chat session", error ?? new Error("No session returned"));
  }

  return data;
}

async function getRequestedSession(input: GetOrCreateSessionInput) {
  if (!input.requestedAgentSessionId) {
    return null;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("channel", input.channel)
    .eq("actor_id", input.actorId)
    .eq("agent_session_id", input.requestedAgentSessionId)
    .eq("status", "active")
    .maybeSingle<ChatSession>();

  if (error) {
    throw sessionStoreError("read requested chat session", error);
  }

  return data;
}

export async function getOrCreateChatSession(input: GetOrCreateSessionInput) {
  const requestedSession = await getRequestedSession(input);

  if (requestedSession) {
    if (isFresh(requestedSession)) {
      await touchChatSession(requestedSession.agent_session_id);
      return {
        ...requestedSession,
        expires_at: expiresAtIso(),
      };
    }

    await markChatSessionEnded(requestedSession.agent_session_id, "expired");
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("channel", input.channel)
    .eq("actor_id", input.actorId)
    .eq("status", "active")
    .order("last_activity_at", { ascending: false })
    .limit(5)
    .returns<ChatSession[]>();

  if (error) {
    throw sessionStoreError("read active chat sessions", error);
  }

  for (const session of data ?? []) {
    if (isFresh(session)) {
      await touchChatSession(session.agent_session_id);
      return {
        ...session,
        expires_at: expiresAtIso(),
      };
    }

    await markChatSessionEnded(session.agent_session_id, "expired");
  }

  return createChatSession(input.channel, input.actorId);
}
