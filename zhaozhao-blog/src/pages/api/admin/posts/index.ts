import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import { postInputSchema, postMediaInputSchema } from "../../../../lib/admin/schemas";
import { createPostWithMedia, listPosts } from "../../../../lib/database/admin-repository";

export const GET: APIRoute = ({ request }) => handleAdminRequest(request, listPosts);
export const POST: APIRoute = ({ request }) => handleAdminRequest(
  request,
  async (database) => {
    const body = await readAdminJson(request);
    const post = postInputSchema.parse(body);
    const media = postMediaInputSchema.parse(body);
    return createPostWithMedia(database, post, media);
  },
);
