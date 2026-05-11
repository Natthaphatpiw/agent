import { randomUUID } from "crypto";

import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export type ChatChannel = "web" | "line";
export type ChatSessionStatus = "active" | "ended" | "expired";

export type ChatSession = {
  id: string;
  channel: ChatChannel;
  actor_id: string;
  status: ChatSessionStatus;
  agent_session_id: string;
  last_activity_at: string;
  expires_at: string;
  created_at: string;
  ended_at: string | null;
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

const DEFAULT_SESSION_TTL_SECONDS = 3600;

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
