import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson } from "../../../lib/admin/http";
import { importBlogData, type BlogBackup } from "../../../lib/database/admin-repository";

export const POST: APIRoute = ({ request }) => handleAdminRequest(request, async (database) => {
  await importBlogData(database, await readAdminJson(request) as BlogBackup);
  return { imported: true };
});
