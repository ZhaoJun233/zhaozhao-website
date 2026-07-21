import { createHmac } from "node:crypto";
import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { createGuestbookMessage, listApprovedMessages } from "../../lib/database/message-repository";
import { verifyTurnstileToken } from "../../lib/turnstile";

const attempts = new Map<string, { count: number; resetAt: number }>();
const windowMs = 10 * 60 * 1_000;

export const GET: APIRoute = async () => Response.json(await listApprovedMessages(env.DB), {
  headers: { "cache-control": "no-store" },
});

export const POST: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) {
    return Response.json({ error: "请求来源不受信任。" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "留言接口只接受 JSON。" }, { status: 415 });
  }
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const now = Date.now();
  const current = attempts.get(ip);
  if (current && current.resetAt > now && current.count >= 5) {
    return Response.json({ error: "提交过于频繁，请稍后再试。" }, { status: 429 });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.company === "string" && body.company.trim()) {
      return Response.json({ accepted: true }, { status: 202 });
    }
    const turnstileToken = typeof body["cf-turnstile-response"] === "string"
      ? body["cf-turnstile-response"]
      : "";
    if (!(await verifyTurnstileToken(env.TURNSTILE_SECRET_KEY, turnstileToken, ip))) {
      return Response.json({ error: "人机验证未通过，请重试。" }, {
        status: 403,
        headers: { "cache-control": "no-store" },
      });
    }
    const ipHash = createHmac("sha256", env.ADMIN_SESSION_SECRET).update(ip).digest("hex");
    await createGuestbookMessage(env.DB, { ...body, ipHash });
    attempts.set(ip, current && current.resetAt > now
      ? { count: current.count + 1, resetAt: current.resetAt }
      : { count: 1, resetAt: now + windowMs });
    return Response.json({ accepted: true, message: "留言已提交，审核后会出现在这里。" }, {
      status: 202,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error && error.name.includes("Zod")
      ? "请检查昵称、网址、邮箱和留言长度。"
      : "留言提交失败，请稍后再试。";
    return Response.json({ error: message }, { status: 422, headers: { "cache-control": "no-store" } });
  }
};
