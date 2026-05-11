import { randomUUID } from "crypto";

import type { NextRequest } from "next/server";

import { invokeAgentJsonlEvents, stopAgentRuntimeSession } from "@/lib/agentcore";
import { getOrCreateChatSession, markChatSessionEnded, touchChatSession } from "@/lib/sessions";

export const runtime = "nodejs";

const WEB_ACTOR_COOKIE = "agent_portal_actor_id";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

type ChatRequestBody = {
  message?: unknown;
  sessionId?: unknown;
  channel?: unknown;
  userId?: unknown;
};

function jsonError(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

function sanitizeActorSeed(value: string) {
  const sanitized = value.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 128);

  return sanitized || randomUUID();
}

function encodeSse(event: string, data: unknown) {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function publicErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "เกิดข้อผิดพลาดในการเชื่อมต่อผู้ช่วย";
}

export async function POST(request: NextRequest) {
  let body: ChatRequestBody;

  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return jsonError("Request body must be valid JSON.");
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  const requestedSessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : undefined;
  const requestedChannel = typeof body.channel === "string" ? body.channel : "web";

  if (requestedChannel !== "web") {
    return jsonError("This endpoint accepts only web chat messages.");
  }

  if (!message) {
    return jsonError("กรุณากรอกข้อความก่อนส่ง");
  }

  const cookieActorSeed = request.cookies.get(WEB_ACTOR_COOKIE)?.value;
  const requestActorSeed = typeof body.userId === "string" ? body.userId.trim() : "";
  const actorSeed = sanitizeActorSeed(cookieActorSeed || requestActorSeed || randomUUID());
  const actorId = actorSeed.startsWith("web:") ? actorSeed : `web:${actorSeed}`;
  const createdActorCookie = !cookieActorSeed;

  let session;

  try {
    session = await getOrCreateChatSession({
      channel: "web",
      actorId,
      requestedAgentSessionId: requestedSessionId,
    });
  } catch (error) {
    return jsonError(publicErrorMessage(error), 500);
  }

  const stream = new ReadableStream({
    async start(controller) {
      let sessionEnded = false;

      try {
        controller.enqueue(
          encodeSse("session", {
            sessionId: session.agent_session_id,
            expiresAt: session.expires_at,
          }),
        );

        for await (const event of invokeAgentJsonlEvents(
          {
            input_type: "text",
            response_format: "jsonl",
            channel: "web",
            session_id: session.agent_session_id,
            user_id: actorId,
            prompt: message,
          },
          session.agent_session_id,
        )) {
          if (request.signal.aborted) {
            await touchChatSession(session.agent_session_id);
            return;
          }

          if (event.type === "text_delta" && typeof event.text === "string") {
            controller.enqueue(encodeSse("text_delta", { text: event.text }));
          } else if (event.type === "session_state") {
            sessionEnded = event.session_ended === true;
            controller.enqueue(encodeSse("session_state", event));
          } else {
            controller.enqueue(encodeSse("agent_event", event));
          }
        }

        if (sessionEnded) {
          await markChatSessionEnded(session.agent_session_id, "ended");
          await stopAgentRuntimeSession(session.agent_session_id);
        } else {
          await touchChatSession(session.agent_session_id);
        }

        controller.enqueue(
          encodeSse("done", {
            sessionId: sessionEnded ? null : session.agent_session_id,
            sessionEnded,
          }),
        );
      } catch (error) {
        if (request.signal.aborted) {
          return;
        }

        controller.enqueue(encodeSse("error", { message: publicErrorMessage(error) }));
      } finally {
        if (!request.signal.aborted) {
          controller.close();
        }
      }
    },
  });

  const headers = new Headers({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
  });

  if (createdActorCookie) {
    headers.set(
      "Set-Cookie",
      `${WEB_ACTOR_COOKIE}=${encodeURIComponent(
        actorSeed,
      )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ONE_YEAR_SECONDS}`,
    );
  }

  return new Response(stream, { headers });
}
