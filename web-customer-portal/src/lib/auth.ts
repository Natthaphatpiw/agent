import { createHmac, timingSafeEqual } from "crypto";

import type { NextRequest } from "next/server";

export const WEB_AUTH_COOKIE = "agent_portal_web_auth";
const DEFAULT_AUTH_TTL_SECONDS = 60 * 60 * 24 * 7;

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
};

type AuthTokenPayload = AuthUser & {
  exp: number;
};

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getAuthSecret() {
  const secret = process.env.WEB_AUTH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!secret) {
    throw new Error("Missing WEB_AUTH_SECRET or SUPABASE_SERVICE_ROLE_KEY for auth cookies.");
  }

  return secret;
}

function signPayload(encodedPayload: string) {
  return createHmac("sha256", getAuthSecret()).update(encodedPayload).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
}

export function createAuthToken(user: AuthUser, ttlSeconds = DEFAULT_AUTH_TTL_SECONDS) {
  const payload: AuthTokenPayload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifyAuthToken(token: string | undefined | null): AuthUser | null {
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature || !safeEqual(signature, signPayload(encodedPayload))) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as AuthTokenPayload;

    if (!payload.id || !payload.username || !payload.displayName || payload.exp < Date.now() / 1000) {
      return null;
    }

    return {
      id: payload.id,
      username: payload.username,
      displayName: payload.displayName,
    };
  } catch {
    return null;
  }
}

export function getAuthUserFromRequest(request: NextRequest) {
  return verifyAuthToken(request.cookies.get(WEB_AUTH_COOKIE)?.value);
}

export function authCookieHeader(token: string, ttlSeconds = DEFAULT_AUTH_TTL_SECONDS) {
  return `${WEB_AUTH_COOKIE}=${encodeURIComponent(
    token,
  )}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttlSeconds}`;
}

export function clearAuthCookieHeader() {
  return `${WEB_AUTH_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}
