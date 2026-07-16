import type { APIRoute } from "astro";
import { loadRuntimeEditorial, loadRuntimeProfile } from "../../lib/runtime-content";

export const GET: APIRoute = async () => {
  const [profile, content] = await Promise.all([loadRuntimeProfile(), loadRuntimeEditorial()]);
  return Response.json({ profile, ...content, generatedAt: new Date().toISOString() }, {
    headers: { "cache-control": "no-store" },
  });
};
