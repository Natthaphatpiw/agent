import json
import os
from typing import Any, AsyncIterator

from strands import Agent
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from model.load import load_model
from mcp_client.client import get_gateway_tools
from memory.session import get_memory_session_manager, record_memory_event
from voice.bidi import stream_voice_response

app = BedrockAgentCoreApp()
log = app.logger

SESSION_END_MARKER = "<SESSION_END/>"
DEEPSEEK_TOOL_MARKER = "<｜DSML｜function_calls"
SESSION_TTL_SECONDS = int(os.getenv("SESSION_TTL_SECONDS", "3600"))

DEFAULT_SYSTEM_PROMPT = """
คุณคือ Agent ฝ่ายบริการลูกค้า พูดภาษาไทยสุภาพ กระชับ และลงท้ายอย่างเหมาะสมด้วย "ครับ" เมื่อเข้ากับบริบท

หน้าที่หลัก:
- รับคำขอจาก user เพื่อค้นหา สมัครสมาชิก ดูข้อมูลสมาชิก หรือแก้ไขข้อมูลสมาชิก
- ใช้เครื่องมือฐานข้อมูลผ่าน AgentCore Gateway ทุกครั้งที่ต้องค้นหา เพิ่ม อ่าน หรือแก้ไขข้อมูล
- ห้ามเดาหรือแต่งข้อมูลจากฐานข้อมูลเอง ถ้า tool ไม่พบข้อมูล ให้บอกว่าไม่พบตามผลลัพธ์ tool

กติกาความปลอดภัย:
- ห้ามเปิดเผยข้อมูลส่วนตัวของสมาชิกจนกว่าจะยืนยันตัวตนสำเร็จ
- เมื่อพบสมาชิกจากชื่อ ให้ถามยืนยันเบอร์โทรศัพท์และถามคำถามยืนยันตัวตนที่ tool คืนมา
- หากยืนยันตัวตนผิด ให้แจ้งว่าข้อมูลยืนยันไม่ถูกต้อง และให้ลองใหม่ได้โดยไม่เปิดเผยคำตอบที่ถูก
- เมื่อยืนยันตัวตนสำเร็จเท่านั้น จึงอ่านหรือแก้ไขข้อมูลสมาชิกได้ โดยใช้ verification_token จาก tool
- การแก้ไขข้อมูลต้องเรียก update_customer_profile พร้อม verification_token ทุกครั้ง

โฟลว์ที่ต้องทำ:
1. ถ้า user ขอข้อมูลจากชื่อ เช่น "ขอข้อมูลของคุณอนงค์หน่อย" ให้เรียก search_customer_by_name
2. ถ้าไม่พบชื่อที่น่าจะใช่ แต่มี suggestions ให้ถามกลับอย่างสุภาพ เช่น "ไม่พบคุณอนงค์ครับ คุณหมายถึงคุณอเนกใช่ไหมครับ"
3. ถ้า user ยืนยันว่าไม่มีจริงและสนใจสมัครสมาชิก ให้ถามข้อมูลที่ต้องใช้ ได้แก่ ชื่อ-นามสกุล เบอร์โทร อีเมลถ้ามี ที่อยู่ถ้ามี คำถามยืนยันตัวตน และคำตอบ
4. เมื่อข้อมูลสมัครครบ ให้เรียก register_customer แล้วตอบขอบคุณและแจ้งว่าสมัครสมาชิกเรียบร้อยแล้ว
5. ถ้าพบสมาชิก ให้ถามเบอร์โทรศัพท์และคำตอบของคำถามยืนยันตัวตน จากนั้นเรียก verify_customer_identity
6. ถ้ายืนยันสำเร็จ ให้ถามว่าต้องการให้ช่วยเรื่องไหน เช่น ดูข้อมูลหรือแก้ไขข้อมูล
7. ถ้า user ขอแก้ไขข้อมูล ให้ถาม field และค่าใหม่ที่ต้องการแก้ จากนั้นเรียก update_customer_profile

จัดการบทสนทนาเป็นราย session: อย่าข้ามขั้นตอนใน session เดิม และถ้าข้อมูลไม่ครบให้ถามเพิ่มทีละเรื่องที่จำเป็น

สัญญาณ session:
- ถ้าผู้ใช้บอกลา ยืนยันว่าไม่มีเรื่องอื่นให้ช่วย หรือ task สำคัญเสร็จสมบูรณ์แล้วและไม่ต้องถามต่อ ให้เติม <SESSION_END/> ไว้ท้ายคำตอบ
- ห้ามอธิบาย marker นี้ให้ผู้ใช้ และห้ามใส่ marker นี้ถ้ายังต้องรอข้อมูลเพิ่มหรือยังอยู่ระหว่างยืนยันตัวตน/สมัครสมาชิก/แก้ไขข้อมูล
"""


def agent_factory():
    cache: dict[str, Agent] = {}

    def get_or_create_agent(session_id: str, actor_id: str) -> Agent:
        key = f"{session_id}/{actor_id}"
        if key not in cache:
            cache[key] = Agent(
                model=load_model(),
                session_manager=get_memory_session_manager(session_id, actor_id),
                system_prompt=DEFAULT_SYSTEM_PROMPT,
                tools=get_gateway_tools(log),
            )
        return cache[key]

    return get_or_create_agent


get_or_create_agent = agent_factory()


def _get_context_value(context: Any, *names: str, default: str) -> str:
    for name in names:
        value = getattr(context, name, None)
        if value:
            return str(value)
    return default


def _get_payload_text(payload: dict[str, Any]) -> str:
    for key in ("prompt", "text", "message", "input"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _get_input_type(payload: dict[str, Any]) -> str:
    explicit = payload.get("input_type") or payload.get("type") or payload.get("modality")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip().lower()
    if payload.get("audio") or payload.get("audio_base64") or payload.get("audio_chunks"):
        return "voice"
    return "text"


def _get_response_format(payload: dict[str, Any]) -> str:
    value = payload.get("response_format") or payload.get("stream_format") or "text"
    return str(value).strip().lower()


def _event_line(event: dict[str, Any]) -> str:
    return json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n"


def _source_metadata(payload: dict[str, Any], input_type: str) -> dict[str, Any]:
    return {
        "input_type": input_type,
        "channel": payload.get("channel") or payload.get("source") or "unknown",
        "client_session_id": payload.get("client_session_id"),
        "line_reply_token": payload.get("line_reply_token"),
    }


class StreamTextCleaner:
    def __init__(self) -> None:
        self._buffer = ""
        self.session_ended = False
        self._markers = (DEEPSEEK_TOOL_MARKER, SESSION_END_MARKER)
        self._max_marker_len = max(len(marker) for marker in self._markers)

    def feed(self, chunk: str) -> str:
        text = self._buffer + chunk
        if SESSION_END_MARKER in text:
            self.session_ended = True

        for marker in self._markers:
            text = text.replace(marker, "")

        keep = max(self._max_marker_len - 1, 0)
        if len(text) <= keep:
            self._buffer = text
            return ""

        output = text[:-keep]
        self._buffer = text[-keep:]
        return output

    def flush(self) -> str:
        text = self._buffer
        self._buffer = ""
        if SESSION_END_MARKER in text:
            self.session_ended = True
        for marker in self._markers:
            text = text.replace(marker, "")
        return text


async def _stream_text_events(
    prompt: str,
    session_id: str,
    actor_id: str,
    metadata: dict[str, Any],
) -> AsyncIterator[dict[str, Any]]:
    agent = get_or_create_agent(session_id, actor_id)
    response_parts: list[str] = []
    cleaner = StreamTextCleaner()

    record_memory_event(
        actor_id=actor_id,
        session_id=session_id,
        role="USER",
        text=prompt,
        metadata=metadata,
        logger=log,
    )

    async for event in agent.stream_async(prompt):
        if "data" in event and isinstance(event["data"], str):
            text = cleaner.feed(event["data"])
            if text:
                response_parts.append(text)
                yield {"type": "text_delta", "text": text}

    tail = cleaner.flush()
    if tail:
        response_parts.append(tail)
        yield {"type": "text_delta", "text": tail}

    response_text = "".join(response_parts).strip()
    if response_text:
        record_memory_event(
            actor_id=actor_id,
            session_id=session_id,
            role="ASSISTANT",
            text=response_text,
            metadata={**metadata, "session_ended": str(cleaner.session_ended).lower()},
            logger=log,
        )

    yield {
        "type": "session_state",
        "session_id": session_id,
        "actor_id": actor_id,
        "session_ended": cleaner.session_ended,
        "ttl_seconds": SESSION_TTL_SECONDS,
    }


async def _stream_text_response(
    prompt: str,
    session_id: str,
    actor_id: str,
    metadata: dict[str, Any],
    response_format: str,
) -> AsyncIterator[str]:
    async for event in _stream_text_events(prompt, session_id, actor_id, metadata):
        if response_format in {"events", "jsonl"}:
            yield _event_line(event)
        elif event.get("type") == "text_delta":
            yield str(event.get("text", ""))


@app.entrypoint
async def invoke(payload, context):
    log.info("Invoking customer service agent")

    payload = payload or {}
    session_id = str(payload.get("session_id") or _get_context_value(context, "session_id", default="default-session"))
    actor_id = str(
        payload.get("actor_id")
        or payload.get("user_id")
        or _get_context_value(context, "user_id", "actor_id", default="default-user")
    )
    input_type = _get_input_type(payload)
    response_format = _get_response_format(payload)

    if input_type in {"voice", "audio"}:
        async for voice_event in stream_voice_response(
            payload=payload,
            tools=get_gateway_tools(log),
            system_prompt=DEFAULT_SYSTEM_PROMPT,
            session_id=session_id,
            actor_id=actor_id,
            logger=log,
        ):
            yield _event_line(voice_event)
        return

    prompt = _get_payload_text(payload)
    if not prompt:
        yield "กรุณาส่งข้อความใน field `prompt` หรือ `text` ครับ"
        return

    metadata = _source_metadata(payload, input_type="text")
    async for chunk in _stream_text_response(prompt, session_id, actor_id, metadata, response_format):
        yield chunk


if __name__ == "__main__":
    app.run()
