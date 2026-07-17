import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { handleAdminRequest } from "../../../../../lib/admin/http";
import { getMediaStore } from "../../../../../lib/cloudflare/bindings";
import { runMediaCleanup } from "../../../../../lib/cloudflare/post-media";
import { queueDraftCleanup } from "../../../../../lib/database/media-repository";

export const DELETE: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  async (database) => {
    const token = z.uuid().parse(params.token);
    const cleanupPending = await queueDraftCleanup(database, token, "draft_cancelled");
    await runMediaCleanup(database, getMediaStore(), 5);
    return { cancelled: true, cleanupPending };
  },
);
