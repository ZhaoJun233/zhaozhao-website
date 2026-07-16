import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import { deleteCategory, getCategory, updateCategory } from "../../../../lib/database/admin-repository";

export const GET: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  (database) => getCategory(database, params.id!),
);
export const PUT: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  async (database) => updateCategory(database, params.id!, await readAdminJson(request) as never),
);
export const DELETE: APIRoute = ({ request, params }) => handleAdminRequest(request, (database) => {
  deleteCategory(database, params.id!);
  return { deleted: true };
});
