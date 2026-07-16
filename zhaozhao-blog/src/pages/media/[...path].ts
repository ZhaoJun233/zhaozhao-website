import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import type { APIRoute } from "astro";
import { runtimeContentRoot } from "../../lib/runtime-content";

const contentTypes: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

export const GET: APIRoute = async ({ params }) => {
  const assetsRoot = resolve(runtimeContentRoot(), "assets");
  const requested = resolve(assetsRoot, params.path ?? "");
  if (requested !== assetsRoot && !requested.startsWith(`${assetsRoot}${sep}`)) {
    return new Response("Not found", { status: 404 });
  }
  const type = contentTypes[extname(requested).toLowerCase()];
  if (!type) return new Response("Not found", { status: 404 });
  try {
    return new Response(await readFile(requested), {
      headers: {
        "content-type": type,
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};
