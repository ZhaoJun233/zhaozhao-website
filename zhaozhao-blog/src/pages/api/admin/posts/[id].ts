import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import { postInputSchema, postMediaInputSchema } from "../../../../lib/admin/schemas";
import {
  deletePost,
  getPost,
  updatePostWithMedia,
} from "../../../../lib/database/admin-repository";

export const GET: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  (database) => getPost(database, params.id!),
);
export const PUT: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  async (database) => {
    const body = await readAdminJson(request);
    const post = postInputSchema.parse(body);
    const media = postMediaInputSchema.parse(body);
    return updatePostWithMedia(database, params.id!, post, media);
  },
);
export const DELETE: APIRoute = ({ request, params }) => handleAdminRequest(request, async (database) => {
  await deletePost(database, params.id!);
  return { deleted: true };
});
