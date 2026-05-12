import type { NextRequest } from "next/server";

import { getAuthUserFromRequest } from "@/lib/auth";
import { forkWebChatRoom, listWebChatMessages } from "@/lib/chatRooms";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    roomId: string;
  }>;
};

type ForkBody = {
  messageId?: unknown;
  content?: unknown;
};

function jsonError(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

function publicErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "สร้างห้องแชทใหม่ไม่สำเร็จ";
}

export async function POST(request: NextRequest, context: RouteContext) {
  const user = getAuthUserFromRequest(request);

  if (!user) {
    return jsonError("กรุณาเข้าสู่ระบบก่อน", 401);
  }

  let body: ForkBody;

  try {
    body = (await request.json()) as ForkBody;
  } catch {
    return jsonError("Request body must be valid JSON.");
  }

  const messageId = typeof body.messageId === "string" ? body.messageId : "";
  const content = typeof body.content === "string" ? body.content.trim() : "";

  if (!messageId || !content) {
    return jsonError("กรุณาระบุข้อความที่ต้องการแก้ไข");
  }

  const { roomId } = await context.params;

  try {
    const result = await forkWebChatRoom({
      userId: user.id,
      actorId: `webuser:${user.id}`,
      sourceRoomId: roomId,
      sourceMessageId: messageId,
      editedContent: content,
    });
    const messages = await listWebChatMessages(result.room.id);

    return Response.json({
      ok: true,
      room: result.room,
      messages,
      sourceRoomId: roomId,
    });
  } catch (error) {
    return jsonError(publicErrorMessage(error), 500);
  }
}
