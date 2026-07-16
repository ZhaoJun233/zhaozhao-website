import { siteConfig } from "../config/site";
import { loadRuntimeProfile } from "../lib/runtime-content";

export async function GET() {
  const profile = await loadRuntimeProfile();
  return new Response(JSON.stringify({
    name: `${profile.name} - ${profile.siteTitle}`,
    short_name: profile.name,
    description: profile.description,
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
    headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "no-store" },
  });
}
