import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import { createCategory, listCategories } from "../../../../lib/database/admin-repository";

export const GET: APIRoute = ({ request }) => handleAdminRequest(request, listCategories);
export const POST: APIRoute = ({ request }) => handleAdminRequest(
  request,
  async (database) => createCategory(database, await readAdminJson(request) as never),
);
