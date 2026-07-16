import type { APIRoute } from "astro";
import {
  clearAdminSessionCookie,
  createAdminSession,
  deleteAdminSession,
  readAdminSessionToken,
  serializeAdminSessionCookie,
  verifyAdminPassword,
} from "../../../../lib/admin/auth";
import { getContentDatabase } from "../../../../lib/database/content-repository";

const attempts = new Map<string, { count: number; resetAt: number }>();
const limitWindow = 5 * 60 * 1_000;

function noStore(headers: HeadersInit = {}): HeadersInit {
  return { "cache-control": "no-store", ...headers };
}

export const POST: APIRoute = async ({ request }) => {
  if (!process.env.ADMIN_PASSWORD) {
    return Response.json({ error: "后台密码尚未配置。" }, { status: 503, headers: noStore() });
  }
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const current = attempts.get(key);
  if (current && current.resetAt > now && current.count >= 5) {
    return Response.json({ error: "尝试次数过多，请稍后再试。" }, { status: 429, headers: noStore() });
  }
  let password = "";
  try {
    const body = await request.json() as { password?: unknown };
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return Response.json({ error: "请求内容格式不正确。" }, { status: 400, headers: noStore() });
  }
  if (!verifyAdminPassword(password)) {
    const next = current && current.resetAt > now
      ? { count: current.count + 1, resetAt: current.resetAt }
      : { count: 1, resetAt: now + limitWindow };
    attempts.set(key, next);
    return Response.json({ error: "密码不正确。" }, { status: 401, headers: noStore() });
  }
  attempts.delete(key);
  const session = createAdminSession(getContentDatabase());
  return Response.json({ authenticated: true }, {
    headers: noStore({
      "set-cookie": serializeAdminSessionCookie(
        session.token,
        session.expiresAt,
        new URL(request.url).protocol === "https:",
      ),
    }),
  });
};

export const DELETE: APIRoute = async ({ request }) => {
  deleteAdminSession(getContentDatabase(), readAdminSessionToken(request));
  return Response.json({ authenticated: false }, {
    headers: noStore({
      "set-cookie": clearAdminSessionCookie(new URL(request.url).protocol === "https:"),
    }),
  });
};
