import type { APIRoute } from "astro";
import { handleAdminRequest } from "../../../../../../lib/admin/http";
import { getMediaStore } from "../../../../../../lib/cloudflare/bindings";
import {
  type MediaCleanupRunner,
  runMediaCleanupBestEffort,
} from "../../../../../../lib/cloudflare/post-media";
import { removePostAsset } from "../../../../../../lib/database/media-repository";

export function createPostAssetRemovalRoute(cleanup?: MediaCleanupRunner): APIRoute {
  return ({ request, params }) => handleAdminRequest(
    request,
    async (database) => {
      await removePostAsset(database, params.id!, params.assetId!);
      await runMediaCleanupBestEffort(database, getMediaStore(), 5, cleanup);
      return { removed: true };
    },
  );
}

export const DELETE = createPostAssetRemovalRoute();
