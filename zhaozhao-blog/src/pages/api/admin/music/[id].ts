import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import { getMediaStore } from "../../../../lib/cloudflare/bindings";
import {
  type MediaCleanupRunner,
  runMediaCleanupBestEffort,
} from "../../../../lib/cloudflare/post-media";
import {
  deleteMusicTrack,
  getMusicTrack,
  updateMusicTrack,
} from "../../../../lib/database/music-repository";

export const GET: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  (database) => getMusicTrack(database, params.id!),
);
export const PUT: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  async (database) => updateMusicTrack(
    database,
    params.id!,
    await readAdminJson(request) as never,
  ),
);
export function createMusicDeleteRoute(cleanup?: MediaCleanupRunner): APIRoute {
  return ({ request, params }) => handleAdminRequest(request, async (database) => {
    await deleteMusicTrack(database, params.id!);
    await runMediaCleanupBestEffort(database, getMediaStore(), 5, cleanup);
    return { deleted: true };
  });
}

export const DELETE = createMusicDeleteRoute();
