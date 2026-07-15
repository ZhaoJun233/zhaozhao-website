import type { APIRoute } from "astro";
import { siteConfig } from "../config/site";

export const GET: APIRoute = ({ site }) => {
  const siteUrl = site ?? new URL(siteConfig.siteUrl);
  const sitemapUrl = new URL("sitemap-index.xml", siteUrl);
  const body = [
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${sitemapUrl.href}`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
