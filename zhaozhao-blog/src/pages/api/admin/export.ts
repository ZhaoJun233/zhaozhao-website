import type { APIRoute } from "astro";
import { handleAdminRequest } from "../../../lib/admin/http";
import { exportBlogData } from "../../../lib/database/admin-repository";

export const GET: APIRoute = ({ request }) => handleAdminRequest(request, async (database) => {
  const backup = await exportBlogData(database);
  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="233zhao-blog-${backup.exportedAt.slice(0, 10)}.json"`,
    },
  });
});
