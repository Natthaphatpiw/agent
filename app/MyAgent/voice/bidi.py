from __future__ import annotations

import asyncio
import os
from typing import Any, AsyncIterator

from memory.session import record_memory_event

SESSION_END_MARKER = "<SESSION_END/>"
SESSION_TTL_SECONDS = int(os.getenv("SESSION_TTL_SECONDS", "3600"))


def _audio_chunks(payload: dict[str, Any]) -> list[str]:
    chunks = payload.get("audio_chunks")
    if isinstance(chunks, list):
        return [str(chunk) for chunk in chunks if chunk]

    single_chunk = payload.get("audio_base64") or payload.get("audio")
    if isinstance(single_chunk, str) and single_chunk.strip():
        return [single_chunk.strip()]

    return []


def _sample_rate(payload: dict[str, Any]) -> int:
    value = int(payload.get("sample_rate") or os.getenv("VOICE_INPUT_SAMPLE_RATE", "16000"))
    return value if value in {16000, 24000, 48000} else 16000


def _channels(payload: dict[str, Any]) -> int:
    value = int(payload.get("channels") or os.getenv("VOICE_INPUT_CHANNELS", "1"))
    return value if value in {1, 2} else 1


def _clean_text(text: str) -> tuple[str, bool]:
    return text.replace(SESSION_END_MARKER, ""), SESSION_END_MARKER in text


def _voice_model(audio_format: str, sample_rate: int, channels: int):
    from strands.experimental.bidi.models import BidiNovaSonicModel

    region = os.getenv("VOICE_AWS_REGION") or os.getenv("AWS_REGION") or "us-east-1"
    return BidiNovaSonicModel(
        model_id=os.getenv("VOICE_MODEL_ID", "amazon.nova-2-sonic-v1:0"),
        provider_config={
            "audio": {
                "input_rate": sample_rate,
                "output_rate": int(os.getenv("VOICE_OUTPUT_SAMPLE_RATE", "16000")),
                "voice": os.getenv("VOICE_OUTPUT_VOICE", "ruth"),
                "channels": channels,
                "format": audio_format,
            }
        },
        client_config={"region": region},
    )


def _event_payload(event: Any) -> dict[str, Any]:
    event_type = event.get("type") if isinstance(event, dict) else type(event).__name__

    if event_type == "bidi_audio_stream":
        return {
            "type": "assistant_audio",
            "audio": event.get("audio"),
            "audio_format": event.get("format"),
            "sample_rate": event.get("sample_rate"),
            "channels": event.get("channels"),
        }

    if event_type == "bidi_transcript_stream":
        text, text_ended = _clean_text(str(event.get("text") or ""))
        current_transcript, current_ended = _clean_text(str(event.get("current_transcript") or ""))
        return {
            "type": "transcript",
            "role": event.get("role"),
            "text": text,
            "is_final": event.get("is_final"),
            "current_transcript": current_transcript,
            "session_ended": text_ended or current_ended,
        }

    if event_type == "bidi_response_complete":
        return {
            "type": "response_complete",
            "response_id": event.get("response_id"),
            "stop_reason": event.get("stop_reason"),
        }

    if event_type == "bidi_usage":
        return {
            "type": "usage",
            "input_tokens": event.get("inputTokens"),
            "output_tokens": event.get("outputTokens"),
            "total_tokens": event.get("totalTokens"),
        }

    if event_type == "bidi_error":
        return {
            "type": "error",
            "code": event.get("code"),
            "message": event.get("message"),
            "details": event.get("details"),
        }

    return {"type": event_type or "voice_event"}


async def stream_voice_response(
    payload: dict[str, Any],
    tools: list[Any],
    system_prompt: str,
    session_id: str,
    actor_id: str,
    logger: Any | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Run one Nova Sonic bidirectional turn from base64 audio chunks and yield JSON-safe events."""
    from strands.experimental.bidi import BidiAgent
    from strands.experimental.bidi.types.events import BidiAudioInputEvent, BidiTextInputEvent

    chunks = _audio_chunks(payload)
    prompt = payload.get("prompt") or payload.get("text") or payload.get("message")
    if not chunks and not prompt:
        yield {
            "type": "error",
            "message": "Voice input requires `audio`, `audio_base64`, `audio_chunks`, or a text `prompt`.",
        }
        return

    audio_format = str(payload.get("audio_format") or os.getenv("VOICE_INPUT_FORMAT", "pcm")).lower()
    sample_rate = _sample_rate(payload)
    channels = _channels(payload)
    chunk_delay = float(payload.get("chunk_delay_ms") or os.getenv("VOICE_CHUNK_DELAY_MS", "0")) / 1000
    timeout_seconds = float(payload.get("voice_timeout_seconds") or os.getenv("VOICE_TIMEOUT_SECONDS", "30"))

    agent = BidiAgent(
        model=_voice_model(audio_format, sample_rate, channels),
        tools=tools,
        system_prompt=system_prompt,
        agent_id=f"{actor_id}:{session_id}",
        name="CustomerServiceVoiceAgent",
    )

    user_transcripts: list[str] = []
    assistant_transcripts: list[str] = []
    session_ended = False

    try:
        await agent.start(invocation_state={"actor_id": actor_id, "session_id": session_id})

        if isinstance(prompt, str) and prompt.strip():
            await agent.send(BidiTextInputEvent(prompt.strip()))

        for chunk in chunks:
            await agent.send(BidiAudioInputEvent(chunk, audio_format, sample_rate, channels))
            if chunk_delay > 0:
                await asyncio.sleep(chunk_delay)

        receiver = agent.receive().__aiter__()
        deadline = asyncio.get_running_loop().time() + timeout_seconds

        while True:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                yield {"type": "error", "message": "Timed out waiting for Nova Sonic voice response."}
                break

            try:
                event = await asyncio.wait_for(receiver.__anext__(), timeout=remaining)
            except StopAsyncIteration:
                break

            event_payload = _event_payload(event)

            if event_payload["type"] == "transcript" and event_payload.get("is_final"):
                session_ended = session_ended or bool(event_payload.get("session_ended"))
                text = str(event_payload.get("current_transcript") or event_payload.get("text") or "").strip()
                if text and event_payload.get("role") == "user":
                    user_transcripts.append(text)
                if text and event_payload.get("role") == "assistant":
                    assistant_transcripts.append(text)

            yield event_payload

            if event_payload["type"] == "response_complete":
                break

    except Exception as exc:
        if logger:
            logger.exception("Nova Sonic voice invocation failed")
        yield {"type": "error", "message": str(exc), "code": type(exc).__name__}
    finally:
        await agent.stop()

    yield {
        "type": "session_state",
        "session_id": session_id,
        "actor_id": actor_id,
        "session_ended": session_ended,
        "ttl_seconds": SESSION_TTL_SECONDS,
    }

    record_memory_event(
        actor_id=actor_id,
        session_id=session_id,
        role="USER",
        text="\n".join(user_transcripts) if user_transcripts else "[voice input]",
        metadata={"input_type": "voice"},
        logger=logger,
    )
    if assistant_transcripts:
        record_memory_event(
            actor_id=actor_id,
            session_id=session_id,
            role="ASSISTANT",
            text="\n".join(assistant_transcripts),
            metadata={"input_type": "voice", "session_ended": str(session_ended).lower()},
            logger=logger,
        )
