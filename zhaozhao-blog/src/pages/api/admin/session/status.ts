import type { APIRoute } from "astro";
import { authenticateAdminSession, readAdminSessionToken } from "../../../../lib/admin/auth";
import { getContentDatabase } from "../../../../lib/database/content-repository";

export const GET: APIRoute = async ({ request }) => {
  const session = authenticateAdminSession(
    getContentDatabase(),
    readAdminSessionToken(request),
  );
  return Response.json({ authenticated: Boolean(session) }, {
    status: session ? 200 : 401,
    headers: { "cache-control": "no-store" },
  });
};
