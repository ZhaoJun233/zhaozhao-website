import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import { createPost, listPosts } from "../../../../lib/database/admin-repository";

export const GET: APIRoute = ({ request }) => handleAdminRequest(request, listPosts);
export const POST: APIRoute = ({ request }) => handleAdminRequest(
  request,
  async (database) => createPost(database, await readAdminJson(request) as never),
);
