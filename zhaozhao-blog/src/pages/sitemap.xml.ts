import type { APIRoute } from "astro";
import { buildCategoryIndex, buildTaxonomyIndex } from "../lib/content";
import { loadRuntimeEditorial, loadRuntimePosts, loadRuntimeProjects } from "../lib/runtime-content";

function escapeXml(value: string): string {
  return value.replace(/[<>&'\"]/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    "\"": "&quot;",
  })[character]!);
}

export const GET: APIRoute = async ({ site }) => {
  const root = site ?? new URL("http://localhost:4321");
  const [editorial, allPosts, projects] = await Promise.all([
    loadRuntimeEditorial(),
    loadRuntimePosts(),
    loadRuntimeProjects(),
  ]);
  const posts = allPosts.filter(({ data }) => !data.draft);
  const categories = buildCategoryIndex(
    editorial.taxonomy.categories,
    posts.map(({ data }) => data.category),
  );
  const tags = buildTaxonomyIndex(posts.flatMap(({ data }) => data.tags));
  const entries = [
    ...new Set([
      ...editorial.navigation.items.map(({ href }) => href),
      "/archive/",
      "/tags/",
      "/credits/",
      ...posts.map(({ id }) => `/posts/${id}/`),
      ...projects.map(({ id }) => `/projects/${id}/`),
      ...categories.map(({ slug }) => `/categories/${slug}/`),
      ...tags.map(({ slug }) => `/tags/${slug}/`),
    ]),
  ];
  const body = entries.map((path) => `  <url><loc>${escapeXml(new URL(encodeURI(path), root).href)}</loc></url>`).join("\n");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`, {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store" },
  });
};
