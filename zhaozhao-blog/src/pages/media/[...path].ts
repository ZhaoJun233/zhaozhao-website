import type { APIRoute } from "astro";
import { getMediaBucket } from "../../lib/cloudflare/bindings";
import { readAdminMedia } from "../../lib/cloudflare/media";

export const GET: APIRoute = ({ params }) => readAdminMedia(
  getMediaBucket(),
  params.path ?? "",
);
