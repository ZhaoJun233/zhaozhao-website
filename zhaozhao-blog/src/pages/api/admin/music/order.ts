import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import { orderMusicTracks } from "../../../../lib/database/music-repository";

const orderSchema = z.object({ ids: z.array(z.uuid()).max(100) });

export const PUT: APIRoute = ({ request }) => handleAdminRequest(request, async (database) => {
  const { ids } = orderSchema.parse(await readAdminJson(request));
  return orderMusicTracks(database, ids);
});
