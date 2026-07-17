import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { AdminHttpError, handleAdminRequest } from "../../../../lib/admin/http";
import { getMediaStore } from "../../../../lib/cloudflare/bindings";
import { MediaUploadError } from "../../../../lib/cloudflare/media";
import { runMediaCleanup, uploadPostImage } from "../../../../lib/cloudflare/post-media";

const ownerSchema = z.object({
  draftToken: z.uuid().optional(),
  postId: z.uuid().optional(),
}).refine(
  ({ draftToken, postId }) => Boolean(draftToken) !== Boolean(postId),
  { message: "draftToken 与 postId 必须且只能提供一个。" },
);

export const POST: APIRoute = ({ request }) => handleAdminRequest(request, async (database) => {
  if (!request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
    throw new AdminHttpError(415, "图片上传接口只接受 multipart/form-data。");
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.name) {
    throw new AdminHttpError(400, "请选择要上传的图片。");
  }
  const owner = ownerSchema.parse({
    draftToken: form.get("draftToken") ?? undefined,
    postId: form.get("postId") ?? undefined,
  });
  const imageOwner = owner.draftToken
    ? { draftToken: owner.draftToken }
    : { postId: owner.postId! };
  const store = getMediaStore();
  try {
    const asset = await uploadPostImage(database, store, file, imageOwner);
    await runMediaCleanup(database, store, 5);
    return { asset };
  } catch (error) {
    if (error instanceof MediaUploadError) {
      throw new AdminHttpError(error.status, error.message);
    }
    throw error;
  }
});
