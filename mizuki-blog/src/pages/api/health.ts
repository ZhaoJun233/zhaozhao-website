import type { APIRoute } from "astro";

export const GET: APIRoute = () => Response.json({ status: "ok", mode: "ssr" }, {
  headers: { "cache-control": "no-store" },
});
