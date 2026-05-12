import type { NextRequest } from "next/server";

import { getAuthUserFromRequest } from "@/lib/auth";
import { createWebChatRoom, listWebChatRooms } from "@/lib/chatRooms";

export const runtime = "nodejs";

type CreateRoomBody = {
  title?: unknown;
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

export async function GET(request: NextRequest) {
  const user = getAuthUserFromRequest(request);

  if (!user) {
    return jsonError("กรุณาเข้าสู่ระบบก่อน", 401);
  }

  try {
    const rooms = await listWebChatRooms(user.id);

    return Response.json({
      ok: true,
      rooms,
    });
  } catch (error) {
    return jsonError(publicErrorMessage(error), 500);
  }
}

export async function POST(request: NextRequest) {
  const user = getAuthUserFromRequest(request);

  if (!user) {
    return jsonError("กรุณาเข้าสู่ระบบก่อน", 401);
  }

  let body: CreateRoomBody = {};

  try {
    body = (await request.json()) as CreateRoomBody;
  } catch {
    body = {};
  }

  try {
    const room = await createWebChatRoom({
      userId: user.id,
      actorId: `webuser:${user.id}`,
      title: typeof body.title === "string" ? body.title.trim() : undefined,
    });

    return Response.json({
      ok: true,
      room,
      messages: [],
    });
  } catch (error) {
    return jsonError(publicErrorMessage(error), 500);
  }
}
