from __future__ import annotations

import os
import uuid
from datetime import datetime
from typing import Any, Optional

from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig
from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager

MEMORY_ID = os.getenv("AGENTCORE_MEMORY_ID") or os.getenv("MEMORY_MYAGENTMEMORY_ID")
REGION = os.getenv("AWS_REGION") or os.getenv("AWS_DEFAULT_REGION") or "ap-southeast-2"


def _memory_client():
    import boto3

    return boto3.client("bedrock-agentcore", region_name=REGION)


def get_memory_session_manager(session_id: Optional[str], actor_id: str) -> Optional[AgentCoreMemorySessionManager]:
    if not MEMORY_ID:
        return None

    # AgentCoreMemoryConfig rejects None; OAuth/CUSTOM_JWT callers can reach us
    # without a runtime session header, so synthesize one when absent.
    session_id = session_id or uuid.uuid4().hex


    return AgentCoreMemorySessionManager(
        AgentCoreMemoryConfig(
            memory_id=MEMORY_ID,
            session_id=session_id,
            actor_id=actor_id,
        ),
        REGION
    )


def record_memory_event(
    actor_id: str,
    session_id: str,
    role: str,
    text: str,
    metadata: dict[str, Any] | None = None,
    logger: Any | None = None,
    event_timestamp: datetime | None = None,
) -> None:
    """Record a conversational event in AgentCore Memory using the data-plane API."""
    if not MEMORY_ID or os.getenv("AGENTCORE_RECORD_EVENTS", "1") == "0":
        return

    if event_timestamp is None:
        event_timestamp = datetime.utcnow()

    event_metadata = {
        key: {"stringValue": str(value)}
        for key, value in (metadata or {}).items()
        if value is not None
    }
    payload = [
        {
            "conversational": {
                "content": {"text": text},
                "role": role,
            }
        }
    ]
    params = {
        "memoryId": MEMORY_ID,
        "actorId": actor_id,
        "sessionId": session_id,
        "eventTimestamp": event_timestamp,
        "payload": payload,
        "clientToken": str(uuid.uuid4()),
    }
    if event_metadata:
        params["metadata"] = event_metadata

    try:
        response = _memory_client().create_event(**params)
        event = response["event"]
        if logger:
            logger.info("Created AgentCore Memory event: %s", event["eventId"])
    except Exception as exc:
        if logger:
            logger.warning("Unable to record AgentCore Memory event: %s", exc)
