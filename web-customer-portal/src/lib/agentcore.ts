import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
  StopRuntimeSessionCommand,
} from "@aws-sdk/client-bedrock-agentcore";
import type { StreamingBlobPayloadOutputTypes } from "@smithy/types";

const DEFAULT_REGION = "ap-southeast-2";
const DEFAULT_RUNTIME_ARN =
  "arn:aws:bedrock-agentcore:ap-southeast-2:885418708466:runtime/agentP_MyAgent-dZmbmm3KDS";

let agentCoreClient: BedrockAgentCoreClient | null = null;

export type AgentJsonEvent = {
  type?: string;
  text?: string;
  session_id?: string;
  actor_id?: string;
  session_ended?: boolean;
  ttl_seconds?: number;
  [key: string]: unknown;
};

export type AgentRuntimePayload = {
  input_type: "text" | "voice";
  channel: "web" | "line";
  session_id: string;
  user_id: string;
  response_format?: "jsonl";
  prompt?: string;
  line_reply_token?: string;
  audio_format?: "pcm";
  sample_rate?: number;
  channels?: number;
  audio_base64?: string;
};

function getAgentCoreClient() {
  if (!agentCoreClient) {
    agentCoreClient = new BedrockAgentCoreClient({
      region: process.env.AWS_REGION || DEFAULT_REGION,
    });
  }

  return agentCoreClient;
}

function getRuntimeArn() {
  return process.env.AGENTCORE_RUNTIME_ARN || DEFAULT_RUNTIME_ARN;
}

function parseEventValue(value: unknown): AgentJsonEvent | null {
  if (!value) {
    return null;
  }

  if (typeof value === "object") {
    const candidate = value as AgentJsonEvent;

    if (typeof candidate.type === "string") {
      return candidate;
    }

    if (typeof candidate.data === "string") {
      return parseEventValue(candidate.data);
    }

    return null;
  }

  if (typeof value !== "string") {
    return null;
  }

  let text = value.trim();

  if (!text || text === "[DONE]") {
    return null;
  }

  if (text.startsWith("data:")) {
    text = text.slice("data:".length).trim();
  }

  try {
    return parseEventValue(JSON.parse(text));
  } catch {
    return null;
  }
}

function parseJsonLine(line: string) {
  const trimmedLine = line.trim();

  if (!trimmedLine) {
    return null;
  }

  if (
    trimmedLine.startsWith("event:") ||
    trimmedLine.startsWith("id:") ||
    trimmedLine.startsWith("retry:") ||
    trimmedLine.startsWith(":")
  ) {
    return null;
  }

  const parsedEvent = parseEventValue(trimmedLine);

  if (parsedEvent) {
    return parsedEvent;
  }

  return {
    type: "text_delta",
    text: trimmedLine,
  } satisfies AgentJsonEvent;
}

function isThinkingEvent(event: AgentJsonEvent) {
  const eventType = typeof event.type === "string" ? event.type.toLowerCase() : "";
  const text = typeof event.text === "string" ? event.text.trim().toLowerCase() : "";

  return (
    eventType.includes("thinking") ||
    eventType.includes("reasoning") ||
    eventType.includes("thought") ||
    text === "thinking" ||
    text === "thinking..."
  );
}

function normalizeTextEvent(event: AgentJsonEvent) {
  if (event.type === "text_delta" && typeof event.text === "string") {
    const nestedEvent = parseEventValue(event.text);

    if (nestedEvent) {
      return nestedEvent;
    }
  }

  return event;
}

function normalizeJsonlLine(line: string) {
  const event = parseJsonLine(line);

  if (!event) {
    return null;
  }

  const normalizedEvent = normalizeTextEvent(event);

  if (isThinkingEvent(normalizedEvent)) {
    return null;
  }

  return normalizedEvent;
}

function parseBufferedText(bufferedText: string) {
  const events: AgentJsonEvent[] = [];
  const remainingLines = bufferedText.split(/\r?\n/);

  for (const line of remainingLines) {
    const event = normalizeJsonlLine(line);

    if (event) {
      events.push(event);
    }
  }

  return events;
}

function maybeSingleLineSsePayload(bufferedText: string) {
  const trimmedText = bufferedText.trim();

  if (!trimmedText.startsWith("data:")) {
    return null;
  }

  const event = normalizeJsonlLine(trimmedText);

  if (!event || event.type !== "text_delta" || typeof event.text !== "string") {
    return event;
  }

  if (event.text.includes("data:")) {
    return null;
  }

  return event;
}

function fallbackTextEvent(bufferedText: string) {
  const text = bufferedText.trim();

  if (!text || text.startsWith("data:")) {
    return null;
  }

  return normalizeTextEvent({
      type: "text_delta",
    text,
  } satisfies AgentJsonEvent);
}

function parseTrailingText(bufferedText: string) {
  const sseEvent = maybeSingleLineSsePayload(bufferedText);

  if (sseEvent) {
    return isThinkingEvent(sseEvent) ? [] : [sseEvent];
  }

  const events = parseBufferedText(bufferedText);

  if (events.length > 0) {
    return events;
  }

  const fallbackEvent = fallbackTextEvent(bufferedText);

  return fallbackEvent && !isThinkingEvent(fallbackEvent) ? [fallbackEvent] : [];
}

async function* streamToTextChunks(stream?: StreamingBlobPayloadOutputTypes) {
  if (!stream) {
    return;
  }

  const decoder = new TextDecoder();
  const asyncIterable = stream as AsyncIterable<Uint8Array | string>;

  if (typeof asyncIterable[Symbol.asyncIterator] === "function") {
    for await (const chunk of asyncIterable) {
      yield typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    }

    const tail = decoder.decode();

    if (tail) {
      yield tail;
    }

    return;
  }

  const maybeWebStream = stream as StreamingBlobPayloadOutputTypes & {
    transformToWebStream?: () => ReadableStream<Uint8Array>;
    transformToString?: () => Promise<string>;
  };

  if (typeof maybeWebStream.transformToWebStream === "function") {
    const reader = maybeWebStream.transformToWebStream().getReader();

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      yield decoder.decode(value, { stream: true });
    }

    const tail = decoder.decode();

    if (tail) {
      yield tail;
    }

    return;
  }

  if (typeof maybeWebStream.transformToString === "function") {
    yield await maybeWebStream.transformToString();
  }
}

export async function* invokeAgentJsonlEvents(
  payload: AgentRuntimePayload,
  runtimeSessionId: string,
) {
  const response = await getAgentCoreClient().send(
    new InvokeAgentRuntimeCommand({
      agentRuntimeArn: getRuntimeArn(),
      runtimeSessionId,
      payload: new TextEncoder().encode(JSON.stringify(payload)),
      contentType: "application/json",
      accept: "application/jsonl",
      qualifier: "DEFAULT",
    }),
  );

  let bufferedText = "";

  for await (const chunk of streamToTextChunks(response.response)) {
    bufferedText += chunk;
    const lines = bufferedText.split(/\r?\n/);
    bufferedText = lines.pop() ?? "";

    for (const line of lines) {
      const event = normalizeJsonlLine(line);

      if (event) {
        yield event;
      }
    }
  }

  for (const event of parseTrailingText(bufferedText)) {
    yield event;
  }
}

export async function collectAgentTextResponse(
  payload: AgentRuntimePayload,
  runtimeSessionId: string,
) {
  let text = "";
  let sessionState: AgentJsonEvent | null = null;

  for await (const event of invokeAgentJsonlEvents(payload, runtimeSessionId)) {
    if (event.type === "text_delta" && typeof event.text === "string") {
      text += event.text;
    }

    if (event.type === "session_state") {
      sessionState = event;
    }
  }

  return {
    text,
    sessionState,
  };
}

export async function stopAgentRuntimeSession(runtimeSessionId: string) {
  try {
    await getAgentCoreClient().send(
      new StopRuntimeSessionCommand({
        agentRuntimeArn: getRuntimeArn(),
        runtimeSessionId,
        qualifier: "DEFAULT",
      }),
    );
  } catch (error) {
    console.warn("Unable to stop AgentCore runtime session", error);
  }
}
