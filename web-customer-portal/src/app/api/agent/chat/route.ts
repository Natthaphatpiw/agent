import { randomUUID } from "crypto";

import type { NextRequest } from "next/server";

import { invokeAgentJsonlEvents, stopAgentRuntimeSession } from "@/lib/agentcore";
import { getAuthUserFromRequest } from "@/lib/auth";
import {
  buildRoomContext,
  getWebChatRoom,
  insertWebChatMessage,
  listWebChatMessages,
  replaceUserMessageAndDeleteFollowing,
} from "@/lib/chatRooms";
import { getOrCreateChatSession, markChatSessionEnded, touchChatSession } from "@/lib/sessions";

export const runtime = "nodejs";

const WEB_ACTOR_COOKIE = "agent_portal_actor_id";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

type ChatRequestBody = {
  message?: unknown;
  sessionId?: unknown;
  channel?: unknown;
  userId?: unknown;
  roomId?: unknown;
  editMessageId?: unknown;
  includeRoomContext?: unknown;
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

async function streamAgentResponse(input: {
  request: NextRequest;
  sessionId: string;
  actorId: string;
  prompt: string;
  onTextDone?: (text: string) => Promise<void>;
  sessionPayload?: Record<string, unknown>;
}) {
  return new ReadableStream({
    async start(controller) {
      let sessionEnded = false;
      let assistantText = "";

      try {
        controller.enqueue(
          encodeSse("session", {
            sessionId: input.sessionId,
            ...input.sessionPayload,
          }),
        );

        for await (const event of invokeAgentJsonlEvents(
          {
            input_type: "text",
            response_format: "jsonl",
            channel: "web",
            session_id: input.sessionId,
            user_id: input.actorId,
            prompt: input.prompt,
          },
          input.sessionId,
        )) {
          if (input.request.signal.aborted) {
            await touchChatSession(input.sessionId);
            return;
          }

          if (event.type === "text_delta" && typeof event.text === "string") {
            assistantText += event.text;
            controller.enqueue(encodeSse("text_delta", { text: event.text }));
          } else if (event.type === "session_state") {
            sessionEnded = event.session_ended === true;
            controller.enqueue(encodeSse("session_state", event));
          } else {
            controller.enqueue(encodeSse("agent_event", event));
          }
        }

        if (assistantText.trim() && input.onTextDone) {
          await input.onTextDone(assistantText);
        }

        if (sessionEnded) {
          await markChatSessionEnded(input.sessionId, "ended");
          await stopAgentRuntimeSession(input.sessionId);
        } else {
          await touchChatSession(input.sessionId);
        }

        controller.enqueue(
          encodeSse("done", {
            sessionId: sessionEnded ? null : input.sessionId,
            sessionEnded,
          }),
        );
      } catch (error) {
        if (input.request.signal.aborted) {
          return;
        }

        controller.enqueue(encodeSse("error", { message: publicErrorMessage(error) }));
      } finally {
        if (!input.request.signal.aborted) {
          controller.close();
        }
      }
    },
  });
}

function sseHeaders(extraHeaders?: HeadersInit) {
  return new Headers({
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no",
    ...extraHeaders,
  });
}

async function handleRoomChat(request: NextRequest, body: ChatRequestBody, message: string, roomId: string) {
  const user = getAuthUserFromRequest(request);

  if (!user) {
    return jsonError("กรุณาเข้าสู่ระบบก่อนใช้แชทขนาดใหญ่", 401);
  }

  const room = await getWebChatRoom(user.id, roomId);

  if (!room) {
    return jsonError("ไม่พบห้องแชทนี้", 404);
  }

  const editMessageId = typeof body.editMessageId === "string" ? body.editMessageId : "";

  try {
    if (editMessageId) {
      await replaceUserMessageAndDeleteFollowing({
        roomId: room.id,
        messageId: editMessageId,
        content: message,
      });
    } else {
      await insertWebChatMessage({
        roomId: room.id,
        role: "user",
        content: message,
      });
    }

    const messages = await listWebChatMessages(room.id);
    const previousMessages = messages.at(-1)?.role === "user" ? messages.slice(0, -1) : messages;
    const roomContext = buildRoomContext(previousMessages);
    const prompt = roomContext ? `${roomContext}\n\nข้อความล่าสุดของผู้ใช้:\n${message}` : message;
    const stream = await streamAgentResponse({
      request,
      sessionId: room.agent_session_id,
      actorId: `webuser:${user.id}`,
      prompt,
      sessionPayload: {
        roomId: room.id,
      },
      onTextDone: async (assistantText) => {
        await insertWebChatMessage({
          roomId: room.id,
          role: "assistant",
          content: assistantText,
        });
      },
    });

    return new Response(stream, { headers: sseHeaders() });
  } catch (error) {
    return jsonError(publicErrorMessage(error), 500);
  }
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
  const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";

  if (requestedChannel !== "web") {
    return jsonError("This endpoint accepts only web chat messages.");
  }

  if (!message) {
    return jsonError("กรุณากรอกข้อความก่อนส่ง");
  }

  if (roomId) {
    return handleRoomChat(request, body, message, roomId);
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

  const stream = await streamAgentResponse({
    request,
    sessionId: session.agent_session_id,
    actorId,
    prompt: message,
    sessionPayload: {
      expiresAt: session.expires_at,
    },
  });

  const headers = sseHeaders();

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
