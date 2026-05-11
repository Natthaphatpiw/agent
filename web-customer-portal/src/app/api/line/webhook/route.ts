import type { NextRequest } from "next/server";

import { collectAgentTextResponse, stopAgentRuntimeSession } from "@/lib/agentcore";
import {
  downloadLineMessageContent,
  replyLineText,
  showLineLoadingAnimation,
  verifyLineSignature,
} from "@/lib/line";
import {
  claimLineDebouncedTextEvents,
  finishLineTurn,
  getOrCreateChatSession,
  markChatSessionEnded,
  markLineMessageEventDropped,
  markLineMessageEventsProcessed,
  markLineTurnProcessing,
  readChatSessionByAgentSessionId,
  registerLineTextMessageEvent,
  startLineDebounceTurn,
} from "@/lib/sessions";

export const runtime = "nodejs";
export const maxDuration = 60;

const LINE_DEBOUNCE_MS = 5000;

type LineWebhookBody = {
  events?: LineWebhookEvent[];
};

type LineWebhookEvent = {
  type?: string;
  replyToken?: string;
  source?: {
    userId?: string;
  };
  message?: {
    id?: string;
    type?: string;
    text?: string;
  };
};

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function safelyShowLineLoading(chatId: string, loadingSeconds = 30) {
  try {
    await showLineLoadingAnimation(chatId, loadingSeconds);
  } catch (error) {
    console.warn("Unable to show LINE loading animation", error);
  }
}

async function releaseLineTurn(agentSessionId: string) {
  try {
    await finishLineTurn(agentSessionId);
  } catch (error) {
    console.warn("Unable to release LINE turn lock", error);
  }
}

function shouldLeaveForDebounce(turnStatus?: string, lockedUntil?: string | null) {
  return turnStatus === "debouncing" && (!lockedUntil || new Date(lockedUntil).getTime() > Date.now());
}

async function handleLineText(event: LineWebhookEvent) {
  const lineUserId = event.source?.userId;
  const replyToken = event.replyToken;
  const lineMessageId = event.message?.id;
  const text = event.message?.text?.trim();

  if (!lineUserId || !replyToken || !lineMessageId || !text) {
    return;
  }

  await safelyShowLineLoading(lineUserId);

  const actorId = `line:${lineUserId}`;
  const session = await getOrCreateChatSession({
    channel: "line",
    actorId,
  });

  const registeredEvent = await registerLineTextMessageEvent({
    lineMessageId,
    lineUserId,
    chatSessionId: session.id,
    agentSessionId: session.agent_session_id,
    replyToken,
    messageText: text,
  });

  if (!registeredEvent.inserted) {
    return;
  }

  const debouncedSession = await startLineDebounceTurn(session.agent_session_id);

  if (!debouncedSession) {
    const currentSession = await readChatSessionByAgentSessionId(session.agent_session_id);

    if (shouldLeaveForDebounce(currentSession?.turn_status, currentSession?.locked_until)) {
      return;
    }

    await markLineMessageEventDropped(lineMessageId);
    return;
  }

  let turnClosed = false;

  try {
    await wait(LINE_DEBOUNCE_MS);

    const processingSession = await markLineTurnProcessing(session.agent_session_id);

    if (!processingSession) {
      await markLineMessageEventDropped(lineMessageId);
      await releaseLineTurn(session.agent_session_id);
      return;
    }

    const cutoffIso = new Date().toISOString();
    const debouncedEvents = await claimLineDebouncedTextEvents({
      chatSessionId: session.id,
      lineUserId,
      cutoffIso,
    });
    const prompt = debouncedEvents
      .map((debouncedEvent) => debouncedEvent.message_text.trim())
      .filter(Boolean)
      .join("\n");

    if (!prompt) {
      await finishLineTurn(session.agent_session_id);
      turnClosed = true;
      return;
    }

    const responseReplyToken = debouncedEvents[0]?.reply_token ?? replyToken;

    const { text: answer, sessionState } = await collectAgentTextResponse(
      {
        input_type: "text",
        response_format: "jsonl",
        channel: "line",
        session_id: session.agent_session_id,
        user_id: actorId,
        line_reply_token: responseReplyToken,
        prompt,
      },
      session.agent_session_id,
    );

    await markLineMessageEventsProcessed(
      debouncedEvents.map((debouncedEvent) => debouncedEvent.line_message_id),
    );

    if (sessionState?.session_ended === true) {
      await markChatSessionEnded(session.agent_session_id, "ended");
      await stopAgentRuntimeSession(session.agent_session_id);
      turnClosed = true;
    } else {
      await finishLineTurn(session.agent_session_id);
      turnClosed = true;
    }

    await replyLineText(responseReplyToken, answer);
  } catch (error) {
    if (!turnClosed) {
      await releaseLineTurn(session.agent_session_id);
    }

    throw error;
  }
}

async function handleLineVoiceFallback(event: LineWebhookEvent) {
  const replyToken = event.replyToken;
  const messageId = event.message?.id;

  if (!replyToken) {
    return;
  }

  if (messageId) {
    try {
      await downloadLineMessageContent(messageId);
    } catch (error) {
      console.warn("Unable to download LINE voice content", error);
    }
  }

  await replyLineText(replyToken, "ตอนนี้ voice บน LINE ยังไม่พร้อม กรุณาพิมพ์ข้อความแทนค่ะ");
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!verifyLineSignature(rawBody, request.headers.get("x-line-signature"))) {
    return Response.json({ ok: false, error: "Invalid LINE signature" }, { status: 401 });
  }

  let payload: LineWebhookBody;

  try {
    payload = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return Response.json({ ok: false, error: "Invalid LINE webhook body" }, { status: 400 });
  }

  await Promise.all((payload.events ?? []).map(async (event) => {
    if (event.type !== "message") {
      return;
    }

    try {
      if (event.message?.type === "text") {
        await handleLineText(event);
      } else if (event.message?.type === "audio") {
        await handleLineVoiceFallback(event);
      }
    } catch (error) {
      console.error("LINE webhook event failed", error);

      if (event.replyToken) {
        await replyLineText(
          event.replyToken,
          "ขออภัยค่ะ ระบบผู้ช่วยสมาชิกมีปัญหาชั่วคราว กรุณาลองใหม่อีกครั้ง",
        );
      }
    }
  }));

  return Response.json({ ok: true });
}
