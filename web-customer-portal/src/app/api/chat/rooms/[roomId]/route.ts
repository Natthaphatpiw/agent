import type { NextRequest } from "next/server";

import { getAuthUserFromRequest } from "@/lib/auth";
import { deleteWebChatRoom, getWebChatRoom, listWebChatMessages } from "@/lib/chatRooms";
import { stopAgentRuntimeSession } from "@/lib/agentcore";
import { markChatSessionEnded } from "@/lib/sessions";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    roomId: string;
  }>;
};

function jsonError(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

function publicErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "จัดการห้องแชทไม่สำเร็จ";
}

export async function GET(request: NextRequest, context: RouteContext) {
  const user = getAuthUserFromRequest(request);

  if (!user) {
    return jsonError("กรุณาเข้าสู่ระบบก่อน", 401);
  }

  const { roomId } = await context.params;

  try {
    const room = await getWebChatRoom(user.id, roomId);

    if (!room) {
      return jsonError("ไม่พบห้องแชทนี้", 404);
    }

    const messages = await listWebChatMessages(room.id);

    return Response.json({
      ok: true,
      room,
      messages,
    });
  } catch (error) {
    return jsonError(publicErrorMessage(error), 500);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const user = getAuthUserFromRequest(request);

  if (!user) {
    return jsonError("กรุณาเข้าสู่ระบบก่อน", 401);
  }

  const { roomId } = await context.params;

  try {
    const room = await getWebChatRoom(user.id, roomId);

    if (!room) {
      return jsonError("ไม่พบห้องแชทนี้", 404);
    }

    await deleteWebChatRoom(user.id, room.id);
    await markChatSessionEnded(room.agent_session_id, "ended").catch(() => undefined);
    await stopAgentRuntimeSession(room.agent_session_id).catch(() => undefined);

    return Response.json({
      ok: true,
    });
  } catch (error) {
    return jsonError(publicErrorMessage(error), 500);
  }
}
