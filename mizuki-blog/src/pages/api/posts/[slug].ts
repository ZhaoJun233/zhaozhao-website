import type { APIRoute } from "astro";
import { loadRuntimePosts } from "../../../lib/runtime-content";

export const GET: APIRoute = async ({ params }) => {
  const post = (await loadRuntimePosts()).find(({ id, data }) => id === params.slug && !data.draft);
  return post
    ? Response.json(post, { headers: { "cache-control": "no-store" } })
    : Response.json({ error: "Post not found" }, { status: 404 });
};
