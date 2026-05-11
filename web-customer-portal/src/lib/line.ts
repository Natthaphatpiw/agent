import { createHmac, timingSafeEqual } from "crypto";

const LINE_REPLY_API = "https://api.line.me/v2/bot/message/reply";
const LINE_CONTENT_API = "https://api-data.line.me/v2/bot/message";
const LINE_LOADING_API = "https://api.line.me/v2/bot/chat/loading/start";
const MAX_LINE_TEXT_LENGTH = 4900;
const MIN_LOADING_SECONDS = 5;
const MAX_LOADING_SECONDS = 60;

function requireEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function verifyLineSignature(rawBody: string, signature: string | null) {
  if (!signature) {
    return false;
  }

  const expectedSignature = createHmac("sha256", requireEnv("LINE_CHANNEL_SECRET"))
    .update(rawBody)
    .digest("base64");
  const actual = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function normalizeLineText(text: string) {
  const trimmedText = text.trim() || "ขออภัยค่ะ ระบบยังไม่มีคำตอบสำหรับข้อความนี้";

  if (trimmedText.length <= MAX_LINE_TEXT_LENGTH) {
    return trimmedText;
  }

  return `${trimmedText.slice(0, MAX_LINE_TEXT_LENGTH - 1)}…`;
}

function normalizeLoadingSeconds(loadingSeconds: number) {
  if (!Number.isFinite(loadingSeconds)) {
    return 20;
  }

  return Math.min(MAX_LOADING_SECONDS, Math.max(MIN_LOADING_SECONDS, Math.round(loadingSeconds)));
}

export async function showLineLoadingAnimation(chatId: string, loadingSeconds = 20) {
  const response = await fetch(LINE_LOADING_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("LINE_CHANNEL_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chatId,
      loadingSeconds: normalizeLoadingSeconds(loadingSeconds),
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`LINE loading animation failed with ${response.status}: ${details}`);
  }
}

export async function replyLineText(replyToken: string, text: string) {
  const response = await fetch(LINE_REPLY_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnv("LINE_CHANNEL_ACCESS_TOKEN")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      replyToken,
      messages: [
        {
          type: "text",
          text: normalizeLineText(text),
        },
      ],
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`LINE reply failed with ${response.status}: ${details}`);
  }
}

export async function downloadLineMessageContent(messageId: string) {
  const response = await fetch(`${LINE_CONTENT_API}/${messageId}/content`, {
    headers: {
      Authorization: `Bearer ${requireEnv("LINE_CHANNEL_ACCESS_TOKEN")}`,
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`LINE content download failed with ${response.status}: ${details}`);
  }

  return response.arrayBuffer();
}
