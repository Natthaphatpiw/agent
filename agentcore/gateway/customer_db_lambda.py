from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

ALLOWED_UPDATE_FIELDS = {
    "full_name",
    "phone_number",
    "email",
    "address",
    "notes",
    "membership_status",
}


def _env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _supabase_url() -> str:
    return _env("SUPABASE_URL").rstrip("/")


def _service_key() -> str:
    return _env("SUPABASE_SERVICE_ROLE_KEY")


def _token_secret() -> bytes:
    return os.environ.get("VERIFICATION_TOKEN_SECRET", _service_key()).encode("utf-8")


def _json_b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _json_b64_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _sign_verification_token(customer_id: str, ttl_seconds: int = 900) -> str:
    body = {
        "customer_id": customer_id,
        "exp": int(time.time()) + ttl_seconds,
    }
    encoded_body = _json_b64(json.dumps(body, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(_token_secret(), encoded_body.encode("utf-8"), hashlib.sha256).digest()
    return f"{encoded_body}.{_json_b64(signature)}"


def _verify_token(customer_id: str, verification_token: str) -> tuple[bool, str]:
    try:
        encoded_body, encoded_signature = verification_token.split(".", 1)
        expected = _json_b64(hmac.new(_token_secret(), encoded_body.encode("utf-8"), hashlib.sha256).digest())
        if not hmac.compare_digest(expected, encoded_signature):
            return False, "invalid_verification_token"

        body = json.loads(_json_b64_decode(encoded_body))
        if body.get("customer_id") != customer_id:
            return False, "token_customer_mismatch"
        if int(body.get("exp", 0)) < int(time.time()):
            return False, "verification_token_expired"
        return True, "verified"
    except Exception:
        return False, "invalid_verification_token"


def _request(method: str, path: str, query: dict[str, Any] | None = None, body: Any | None = None) -> Any:
    url = f"{_supabase_url()}{path}"
    if query:
        url = f"{url}?{urllib.parse.urlencode(query, doseq=True)}"

    headers = {
        "apikey": _service_key(),
        "Authorization": f"Bearer {_service_key()}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if method in {"POST", "PATCH"}:
        headers["Prefer"] = "return=representation"

    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8")
        try:
            detail = json.loads(raw)
        except json.JSONDecodeError:
            detail = raw
        raise RuntimeError(f"Supabase request failed: HTTP {exc.code}: {detail}") from exc


def _rpc(function_name: str, payload: dict[str, Any]) -> Any:
    return _request("POST", f"/rest/v1/rpc/{function_name}", body=payload)


def _mask_phone(phone_number: str | None) -> str | None:
    if not phone_number:
        return None
    digits = "".join(char for char in phone_number if char.isdigit())
    if len(digits) <= 4:
        return "*" * len(digits)
    return f"{'*' * max(len(digits) - 4, 0)}{digits[-4:]}"


def _safe_customer(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "customer_id": row.get("customer_id") or row.get("id"),
        "full_name": row.get("full_name"),
        "masked_phone": row.get("masked_phone") or _mask_phone(row.get("phone_number")),
        "email": row.get("email"),
        "address": row.get("address"),
        "membership_status": row.get("membership_status"),
        "security_question": row.get("security_question"),
        "notes": row.get("notes"),
        "similarity_score": row.get("similarity_score"),
    }


def search_customer_by_name(name: str, limit: int = 5) -> dict[str, Any]:
    rows = _rpc("search_customers", {"query_text": name, "limit_count": max(1, min(int(limit or 5), 10))}) or []
    matches = [_safe_customer(row) for row in rows if row.get("is_likely_match")]
    suggestions = [_safe_customer(row) for row in rows if not row.get("is_likely_match")]

    if matches:
        status = "found"
    elif suggestions:
        status = "not_found_with_suggestions"
    else:
        status = "not_found"

    return {
        "status": status,
        "query": name,
        "matches": matches,
        "suggestions": suggestions,
    }


def verify_customer_identity(customer_id: str, phone_number: str, security_answer: str) -> dict[str, Any]:
    rows = _rpc(
        "verify_customer_secret",
        {
            "customer_uuid": customer_id,
            "phone_number_input": phone_number,
            "security_answer_input": security_answer,
        },
    ) or []
    result = rows[0] if rows else {"verified": False, "reason": "customer_not_found"}

    if not result.get("verified"):
        return {
            "verified": False,
            "reason": result.get("reason", "verification_failed"),
            "customer": _safe_customer(result),
        }

    return {
        "verified": True,
        "reason": "verified",
        "verification_token": _sign_verification_token(customer_id),
        "customer": _safe_customer(result),
    }


def get_customer_profile(customer_id: str, verification_token: str) -> dict[str, Any]:
    verified, reason = _verify_token(customer_id, verification_token)
    if not verified:
        return {"status": reason, "customer": None}

    rows = _request(
        "GET",
        "/rest/v1/customers",
        query={
            "id": f"eq.{customer_id}",
            "select": "id,full_name,phone_number,email,address,membership_status,notes,security_question,created_at,updated_at",
            "limit": "1",
        },
    ) or []
    if not rows:
        return {"status": "customer_not_found", "customer": None}

    row = rows[0]
    return {
        "status": "ok",
        "customer": {
            "customer_id": row.get("id"),
            "full_name": row.get("full_name"),
            "phone_number": row.get("phone_number"),
            "email": row.get("email"),
            "address": row.get("address"),
            "membership_status": row.get("membership_status"),
            "notes": row.get("notes"),
            "security_question": row.get("security_question"),
            "created_at": row.get("created_at"),
            "updated_at": row.get("updated_at"),
        },
    }


def update_customer_profile(customer_id: str, verification_token: str, updates: dict[str, Any]) -> dict[str, Any]:
    verified, reason = _verify_token(customer_id, verification_token)
    if not verified:
        return {"status": reason, "customer": None}

    clean_updates = {key: value for key, value in (updates or {}).items() if key in ALLOWED_UPDATE_FIELDS}
    if not clean_updates:
        return {"status": "no_allowed_updates", "allowed_fields": sorted(ALLOWED_UPDATE_FIELDS), "customer": None}

    rows = _request(
        "PATCH",
        "/rest/v1/customers",
        query={
            "id": f"eq.{customer_id}",
            "select": "id,full_name,phone_number,email,address,membership_status,notes,security_question,updated_at",
        },
        body=clean_updates,
    ) or []

    if not rows:
        return {"status": "customer_not_found", "customer": None}

    return {"status": "updated", "customer": get_customer_profile(customer_id, verification_token)["customer"]}


def register_customer(
    full_name: str,
    phone_number: str,
    security_question: str,
    security_answer: str,
    email: str | None = None,
    address: str | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    rows = _rpc(
        "register_customer",
        {
            "full_name_input": full_name,
            "phone_number_input": phone_number,
            "email_input": email,
            "address_input": address,
            "security_question_input": security_question,
            "security_answer_input": security_answer,
            "notes_input": notes,
        },
    ) or []
    return {"status": "created", "customer": _safe_customer(rows[0]) if rows else None}


def _tool_name(event: dict[str, Any], context: Any) -> str:
    client_context = getattr(context, "client_context", None)
    custom = getattr(client_context, "custom", None) or {}
    original = custom.get("bedrockAgentCoreToolName") or event.get("tool_name") or event.get("toolName") or ""
    if "___" in original:
        return original.rsplit("___", 1)[-1]
    return original


def lambda_handler(event, context):
    event = dict(event or {})
    tool_name = _tool_name(event, context)
    event.pop("tool_name", None)
    event.pop("toolName", None)

    routes = {
        "search_customer_by_name": search_customer_by_name,
        "verify_customer_identity": verify_customer_identity,
        "get_customer_profile": get_customer_profile,
        "update_customer_profile": update_customer_profile,
        "register_customer": register_customer,
    }

    if tool_name not in routes:
        return {
            "status": "unknown_tool",
            "tool_name": tool_name,
            "available_tools": sorted(routes),
        }

    try:
        return routes[tool_name](**event)
    except Exception as exc:
        return {
            "status": "error",
            "tool_name": tool_name,
            "message": str(exc),
            "error_type": type(exc).__name__,
        }
