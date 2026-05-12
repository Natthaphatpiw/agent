import type { NextRequest } from "next/server";

import { getAuthUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return Response.json({
    ok: true,
    user: getAuthUserFromRequest(request),
  });
}
