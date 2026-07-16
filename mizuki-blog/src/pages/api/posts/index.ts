import type { APIRoute } from "astro";
import { loadRuntimePosts } from "../../../lib/runtime-content";
import { sortPostEntries } from "../../../lib/content";

export const GET: APIRoute = async () => {
  const posts = sortPostEntries((await loadRuntimePosts()).filter(({ data }) => !data.draft));
  return Response.json(posts.map(({ html: _html, headings: _headings, ...post }) => post), {
    headers: { "cache-control": "no-store" },
  });
};
