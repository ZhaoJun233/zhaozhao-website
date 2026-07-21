import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  clearAdminSessionCookie,
  createAdminSession,
  deleteAdminSession,
  readAdminSessionToken,
  serializeAdminSessionCookie,
  verifyAdminPassword,
} from "../../../../lib/admin/auth";
import { verifyTurnstileToken } from "../../../../lib/turnstile";

const attempts = new Map<string, { count: number; resetAt: number }>();
const limitWindow = 5 * 60 * 1_000;

function noStore(headers: HeadersInit = {}): HeadersInit {
  return { "cache-control": "no-store", ...headers };
}

export const POST: APIRoute = async ({ request }) => {
  if (!env.ADMIN_PASSWORD) {
    return Response.json({ error: "后台密码尚未配置。" }, { status: 503, headers: noStore() });
  }
  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const current = attempts.get(key);
  if (current && current.resetAt > now && current.count >= 5) {
    return Response.json({ error: "尝试次数过多，请稍后再试。" }, { status: 429, headers: noStore() });
  }
  let password = "";
  let turnstileToken = "";
  try {
    const body = await request.json() as { password?: unknown; turnstileToken?: unknown };
    password = typeof body.password === "string" ? body.password : "";
    turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
  } catch {
    return Response.json({ error: "请求内容格式不正确。" }, { status: 400, headers: noStore() });
  }
  if (!(await verifyTurnstileToken(env.TURNSTILE_SECRET_KEY, turnstileToken, key))) {
    return Response.json({ error: "人机验证未通过，请重试。" }, { status: 403, headers: noStore() });
  }
  if (!verifyAdminPassword(password, env.ADMIN_PASSWORD)) {
    const next = current && current.resetAt > now
      ? { count: current.count + 1, resetAt: current.resetAt }
      : { count: 1, resetAt: now + limitWindow };
    attempts.set(key, next);
    return Response.json({ error: "密码不正确。" }, { status: 401, headers: noStore() });
  }
  attempts.delete(key);
  const session = await createAdminSession(
    env.DB,
    undefined,
    undefined,
    env.ADMIN_SESSION_SECRET,
  );
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
  await deleteAdminSession(env.DB, readAdminSessionToken(request), env.ADMIN_SESSION_SECRET);
  return Response.json({ authenticated: false }, {
    headers: noStore({
      "set-cookie": clearAdminSessionCookie(new URL(request.url).protocol === "https:"),
    }),
  });
};
