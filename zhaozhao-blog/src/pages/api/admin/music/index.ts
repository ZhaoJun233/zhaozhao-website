import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import { createMusicTrack, listMusicTracks } from "../../../../lib/database/music-repository";

export const GET: APIRoute = ({ request }) => handleAdminRequest(request, listMusicTracks);
export const POST: APIRoute = ({ request }) => handleAdminRequest(
  request,
  async (database) => createMusicTrack(database, await readAdminJson(request) as never),
);
