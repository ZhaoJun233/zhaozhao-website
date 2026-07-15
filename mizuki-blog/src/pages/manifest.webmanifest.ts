import { siteConfig } from "../config/site";

export const prerender = true;

export function GET() {
  return new Response(JSON.stringify({
    name: siteConfig.title,
    short_name: siteConfig.name,
    description: siteConfig.description,
    lang: siteConfig.locale,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#fbfaf8",
    theme_color: "#117f89",
    icons: [{
      src: "/favicon.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any maskable",
    }],
  }), {
    headers: { "content-type": "application/manifest+json; charset=utf-8" },
  });
}
