import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { handleAdminRequest } from "../../../../../lib/admin/http";
import { getMediaStore } from "../../../../../lib/cloudflare/bindings";
import {
  type MediaCleanupRunner,
  runMediaCleanupBestEffort,
} from "../../../../../lib/cloudflare/post-media";
import { queueDraftCleanup } from "../../../../../lib/database/media-repository";

export function createDraftCleanupRoute(cleanup?: MediaCleanupRunner): APIRoute {
  return ({ request, params }) => handleAdminRequest(
    request,
    async (database) => {
      const token = z.uuid().parse(params.token);
      const cleanupPending = await queueDraftCleanup(database, token, "draft_cancelled");
      await runMediaCleanupBestEffort(database, getMediaStore(), 5, cleanup);
      return { cancelled: true, cleanupPending };
    },
  );
}

export const DELETE = createDraftCleanupRoute();
