import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import { createProject, listProjects } from "../../../../lib/database/admin-repository";

export const GET: APIRoute = ({ request }) => handleAdminRequest(request, listProjects);
export const POST: APIRoute = ({ request }) => handleAdminRequest(
  request,
  async (database) => createProject(database, await readAdminJson(request) as never),
);
