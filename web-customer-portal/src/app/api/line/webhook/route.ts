import type { NextRequest } from "next/server";

import { collectAgentTextResponse, stopAgentRuntimeSession } from "@/lib/agentcore";
import {
  downloadLineMessageContent,
  replyLineText,
  showLineLoadingAnimation,
  verifyLineSignature,
} from "@/lib/line";
import { getOrCreateChatSession, markChatSessionEnded, touchChatSession } from "@/lib/sessions";

export const runtime = "nodejs";

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

async function safelyShowLineLoading(chatId: string, loadingSeconds = 30) {
  try {
    await showLineLoadingAnimation(chatId, loadingSeconds);
  } catch (error) {
    console.warn("Unable to show LINE loading animation", error);
  }
}

async function handleLineText(event: LineWebhookEvent) {
  const lineUserId = event.source?.userId;
  const replyToken = event.replyToken;
  const text = event.message?.text?.trim();

  if (!lineUserId || !replyToken || !text) {
    return;
  }

  await safelyShowLineLoading(lineUserId);

  const actorId = `line:${lineUserId}`;
  const session = await getOrCreateChatSession({
    channel: "line",
    actorId,
  });

  const { text: answer, sessionState } = await collectAgentTextResponse(
    {
      input_type: "text",
      response_format: "jsonl",
      channel: "line",
      session_id: session.agent_session_id,
      user_id: actorId,
      line_reply_token: replyToken,
      prompt: text,
    },
    session.agent_session_id,
  );

  if (sessionState?.session_ended === true) {
    await markChatSessionEnded(session.agent_session_id, "ended");
    await stopAgentRuntimeSession(session.agent_session_id);
  } else {
    await touchChatSession(session.agent_session_id);
  }

  await replyLineText(replyToken, answer);
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

  for (const event of payload.events ?? []) {
    if (event.type !== "message") {
      continue;
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
  }

  return Response.json({ ok: true });
}
