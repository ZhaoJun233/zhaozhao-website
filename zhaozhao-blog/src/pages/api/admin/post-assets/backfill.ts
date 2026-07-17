import type { APIRoute } from "astro";
import { handleAdminRequest } from "../../../../lib/admin/http";
import { getMediaStore } from "../../../../lib/cloudflare/bindings";
import {
  backfillPostMedia,
  runMediaCleanupBestEffort,
  type MediaCleanupRunner,
} from "../../../../lib/cloudflare/post-media";

export function createPostAssetBackfillRoute(cleanup?: MediaCleanupRunner): APIRoute {
  return ({ request }) => handleAdminRequest(request, async (database) => {
    const store = getMediaStore();
    const result = await backfillPostMedia(database, store);
    await runMediaCleanupBestEffort(database, store, 5, cleanup);
    return result;
  });
}

export const POST = createPostAssetBackfillRoute();
