import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import { orderFriends } from "../../../../lib/database/admin-repository";

const orderSchema = z.object({ ids: z.array(z.uuid()).max(100) });

export const PUT: APIRoute = ({ request }) => handleAdminRequest(request, async (database) => {
  const { ids } = orderSchema.parse(await readAdminJson(request));
  return orderFriends(database, ids);
});
