import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
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
export const DELETE: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  async (database) => {
    await deleteMusicTrack(database, params.id!);
    return { deleted: true };
  },
);
