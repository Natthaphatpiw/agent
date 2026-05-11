from __future__ import annotations

import os
import logging
import atexit
from mcp.client.streamable_http import streamablehttp_client
from strands.tools.mcp.mcp_client import MCPClient

logger = logging.getLogger(__name__)

_mcp_client: MCPClient | None = None
_gateway_tools = None


def _gateway_headers() -> dict[str, str] | None:
    token = os.getenv("CUSTOMER_DB_GATEWAY_BEARER_TOKEN")
    if not token or token.startswith("REPLACE_"):
        return None
    return {"Authorization": f"Bearer {token}"}


def _close_mcp_client() -> None:
    global _mcp_client
    if _mcp_client is None:
        return
    try:
        _mcp_client.__exit__(None, None, None)
    except Exception:
        logger.exception("Failed to close AgentCore Gateway MCP client")
    finally:
        _mcp_client = None


def get_gateway_tools(log: logging.Logger | None = None):
    """Return Gateway MCP tools for the customer database, or an empty list when not configured."""
    global _mcp_client, _gateway_tools

    if _gateway_tools is not None:
        return _gateway_tools

    gateway_url = (
        os.getenv("AGENTCORE_GATEWAY_CUSTOMERDBGATEWAY_URL")
        or os.getenv("CUSTOMER_DB_GATEWAY_URL")
        or ""
    ).strip()
    if not gateway_url or gateway_url.startswith("REPLACE_"):
        (log or logger).warning("CUSTOMER_DB_GATEWAY_URL is not configured; database tools are disabled")
        _gateway_tools = []
        return _gateway_tools

    try:
        headers = _gateway_headers()
        _mcp_client = MCPClient(lambda: streamablehttp_client(gateway_url, headers=headers))
        _mcp_client.__enter__()
        _gateway_tools = _mcp_client.list_tools_sync()
        atexit.register(_close_mcp_client)
        (log or logger).info("Loaded %s customer database tools from AgentCore Gateway", len(_gateway_tools))
        return _gateway_tools
    except Exception:
        (log or logger).exception("Failed to load AgentCore Gateway tools from %s", gateway_url)
        _gateway_tools = []
        return _gateway_tools
