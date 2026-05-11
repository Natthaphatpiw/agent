import { randomUUID } from "crypto";

import type { NextRequest } from "next/server";

import { stopAgentRuntimeSession } from "@/lib/agentcore";
import { endActiveChatSessionsForActor } from "@/lib/sessions";

export const runtime = "nodejs";

const WEB_ACTOR_COOKIE = "agent_portal_actor_id";

type ResetSessionBody = {
  sessionId?: unknown;
  channel?: unknown;
  userId?: unknown;
};

function sanitizeActorSeed(value: string) {
  const sanitized = value.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 128);

  return sanitized || randomUUID();
}

function publicErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "รีเฟรชบทสนทนาไม่สำเร็จ";
}

export async function POST(request: NextRequest) {
  let body: ResetSessionBody;

  try {
    body = (await request.json()) as ResetSessionBody;
  } catch {
    return Response.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  const requestedChannel = typeof body.channel === "string" ? body.channel : "web";

  if (requestedChannel !== "web") {
    return Response.json(
      { ok: false, error: "This endpoint accepts only web chat sessions." },
      { status: 400 },
    );
  }

  const cookieActorSeed = request.cookies.get(WEB_ACTOR_COOKIE)?.value;
  const requestActorSeed = typeof body.userId === "string" ? body.userId.trim() : "";
  const actorSeed = sanitizeActorSeed(cookieActorSeed || requestActorSeed || randomUUID());
  const actorId = actorSeed.startsWith("web:") ? actorSeed : `web:${actorSeed}`;
  const requestedSessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : undefined;

  try {
    const sessions = await endActiveChatSessionsForActor({
      channel: "web",
      actorId,
      requestedAgentSessionId: requestedSessionId,
    });

    await Promise.all(
      sessions.map((session) => stopAgentRuntimeSession(session.agent_session_id)),
    );

    return Response.json({
      ok: true,
      endedSessionIds: sessions.map((session) => session.agent_session_id),
    });
  } catch (error) {
    return Response.json({ ok: false, error: publicErrorMessage(error) }, { status: 500 });
  }
}
