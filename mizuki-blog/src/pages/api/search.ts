import type { APIRoute } from "astro";
import { loadRuntimePosts } from "../../lib/runtime-content";
import { sortPostEntries } from "../../lib/content";

export const GET: APIRoute = async ({ url }) => {
  const query = url.searchParams.get("q")?.normalize("NFKC").trim().toLocaleLowerCase("zh-CN") ?? "";
  const category = url.searchParams.get("category")?.trim();
  const tag = url.searchParams.get("tag")?.trim();
  const posts = sortPostEntries((await loadRuntimePosts()).filter(({ data }) => !data.draft));
  const results = posts.filter((post) => {
    if (category && post.data.category !== category) return false;
    if (tag && !post.data.tags.includes(tag)) return false;
    if (!query) return true;
    const haystack = [post.data.title, post.data.description, post.data.category, ...post.data.tags, post.body]
      .join("\n").normalize("NFKC").toLocaleLowerCase("zh-CN");
    return haystack.includes(query);
  });
  return Response.json(results.map(({ html: _html, headings: _headings, body: _body, ...post }) => post), {
    headers: { "cache-control": "no-store" },
  });
};
