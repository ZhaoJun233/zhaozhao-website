import type { APIRoute } from "astro";
import { getMediaStore } from "../../lib/cloudflare/bindings";
import { readAdminMedia } from "../../lib/cloudflare/media";

export const GET: APIRoute = ({ params }) => readAdminMedia(
  getMediaStore(),
  params.path ?? "",
);
