import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import { postInputSchema, postMediaInputSchema } from "../../../../lib/admin/schemas";
import { getMediaStore } from "../../../../lib/cloudflare/bindings";
import {
  type MediaCleanupRunner,
  runMediaCleanupBestEffort,
} from "../../../../lib/cloudflare/post-media";
import {
  getPost,
  updatePostWithMedia,
} from "../../../../lib/database/admin-repository";
import { queuePostDelete } from "../../../../lib/database/media-repository";

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
export function createPostDeleteRoute(cleanup?: MediaCleanupRunner): APIRoute {
  return ({ request, params }) => handleAdminRequest(request, async (database) => {
    const queued = await queuePostDelete(database, params.id!);
    await runMediaCleanupBestEffort(database, getMediaStore(), 5, cleanup);
    return {
      deleted: true,
      exclusiveImages: queued.exclusiveImages,
      sharedImages: queued.sharedImages,
      cleanupPending: queued.cleanupPending,
    };
  });
}

export const DELETE = createPostDeleteRoute();
