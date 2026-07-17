import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import { deletePost, getPost, updatePost } from "../../../../lib/database/admin-repository";

export const GET: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  (database) => getPost(database, params.id!),
);
export const PUT: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  async (database) => updatePost(database, params.id!, await readAdminJson(request) as never),
);
export const DELETE: APIRoute = ({ request, params }) => handleAdminRequest(request, async (database) => {
  await deletePost(database, params.id!);
  return { deleted: true };
});
