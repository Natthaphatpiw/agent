import type { NextRequest } from "next/server";

import { authCookieHeader, createAuthToken, type AuthUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type LoginBody = {
  username?: unknown;
  password?: unknown;
};

type AuthUserRecord = {
  id: string;
  username: string;
  display_name: string;
};

function jsonError(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

function publicErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "เข้าสู่ระบบไม่สำเร็จ";
}

export async function POST(request: NextRequest) {
  let body: LoginBody;

  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return jsonError("Request body must be valid JSON.");
  }

  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !password) {
    return jsonError("กรุณากรอกชื่อผู้ใช้และรหัสผ่าน");
  }

  try {
    const { data, error } = await getSupabaseAdmin().rpc("authenticate_web_user", {
      username_input: username,
      password_input: password,
    });

    if (error) {
      throw error;
    }

    const records = data as AuthUserRecord[] | null;
    const record = records?.[0];

    if (!record) {
      return jsonError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง", 401);
    }

    const user: AuthUser = {
      id: record.id,
      username: record.username,
      displayName: record.display_name,
    };
    const token = createAuthToken(user);

    return Response.json(
      {
        ok: true,
        user,
      },
      {
        headers: {
          "Set-Cookie": authCookieHeader(token),
        },
      },
    );
  } catch (error) {
    return jsonError(publicErrorMessage(error), 500);
  }
}
