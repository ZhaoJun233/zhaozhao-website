import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import { deleteFriend, getFriend, updateFriend } from "../../../../lib/database/admin-repository";

export const GET: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  (database) => getFriend(database, params.id!),
);
export const PUT: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  async (database) => updateFriend(database, params.id!, await readAdminJson(request) as never),
);
export const DELETE: APIRoute = ({ request, params }) => handleAdminRequest(request, async (database) => {
  await deleteFriend(database, params.id!);
  return { deleted: true };
});
