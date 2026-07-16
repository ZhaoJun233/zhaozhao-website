import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import { deleteProject, getProject, updateProject } from "../../../../lib/database/admin-repository";

export const GET: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  (database) => getProject(database, params.id!),
);
export const PUT: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  async (database) => updateProject(database, params.id!, await readAdminJson(request) as never),
);
export const DELETE: APIRoute = ({ request, params }) => handleAdminRequest(request, (database) => {
  deleteProject(database, params.id!);
  return { deleted: true };
});
