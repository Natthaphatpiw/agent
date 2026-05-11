import json
from typing import Any, AsyncIterator

from strands import Agent
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from model.load import load_model
from mcp_client.client import get_gateway_tools
from memory.session import get_memory_session_manager, record_memory_event
from voice.bidi import stream_voice_response

app = BedrockAgentCoreApp()
log = app.logger

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


def _clean_model_stream_text(text: str) -> str:
    return text.replace("<｜DSML｜function_calls", "")


async def _stream_text_response(prompt: str, session_id: str, actor_id: str) -> AsyncIterator[str]:
    agent = get_or_create_agent(session_id, actor_id)
    response_parts: list[str] = []

    record_memory_event(
        actor_id=actor_id,
        session_id=session_id,
        role="USER",
        text=prompt,
        metadata={"input_type": "text"},
        logger=log,
    )

    async for event in agent.stream_async(prompt):
        if "data" in event and isinstance(event["data"], str):
            text = _clean_model_stream_text(event["data"])
            if text:
                response_parts.append(text)
                yield text

    response_text = "".join(response_parts).strip()
    if response_text:
        record_memory_event(
            actor_id=actor_id,
            session_id=session_id,
            role="ASSISTANT",
            text=response_text,
            metadata={"input_type": "text"},
            logger=log,
        )


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

    if input_type in {"voice", "audio"}:
        async for voice_event in stream_voice_response(
            payload=payload,
            tools=get_gateway_tools(log),
            system_prompt=DEFAULT_SYSTEM_PROMPT,
            session_id=session_id,
            actor_id=actor_id,
            logger=log,
        ):
            yield json.dumps(voice_event, ensure_ascii=False) + "\n"
        return

    prompt = _get_payload_text(payload)
    if not prompt:
        yield "กรุณาส่งข้อความใน field `prompt` หรือ `text` ครับ"
        return

    async for chunk in _stream_text_response(prompt, session_id, actor_id):
        yield chunk


if __name__ == "__main__":
    app.run()
