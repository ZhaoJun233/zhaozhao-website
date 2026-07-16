import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import { createFriend, listFriends } from "../../../../lib/database/admin-repository";

export const GET: APIRoute = ({ request }) => handleAdminRequest(request, listFriends);
export const POST: APIRoute = ({ request }) => handleAdminRequest(
  request,
  async (database) => createFriend(database, await readAdminJson(request) as never),
);
