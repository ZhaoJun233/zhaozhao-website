import type { APIRoute } from "astro";
import { handleAdminRequest } from "../../../../../../lib/admin/http";
import { getMediaStore } from "../../../../../../lib/cloudflare/bindings";
import { runMediaCleanup } from "../../../../../../lib/cloudflare/post-media";
import { removePostAsset } from "../../../../../../lib/database/media-repository";

export const DELETE: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  async (database) => {
    await removePostAsset(database, params.id!, params.assetId!);
    await runMediaCleanup(database, getMediaStore(), 5);
    return { removed: true };
  },
);
