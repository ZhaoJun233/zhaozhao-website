import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import { authenticateAdminSession, readAdminSessionToken } from "../../../../lib/admin/auth";

export const GET: APIRoute = async ({ request }) => {
  const session = await authenticateAdminSession(
    env.DB,
    readAdminSessionToken(request),
    undefined,
    env.ADMIN_SESSION_SECRET,
  );
  return Response.json({ authenticated: Boolean(session) }, {
    status: session ? 200 : 401,
    headers: { "cache-control": "no-store" },
  });
};
