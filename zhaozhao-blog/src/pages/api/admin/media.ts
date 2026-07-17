import type { APIRoute } from "astro";
import { AdminHttpError, handleAdminRequest } from "../../../lib/admin/http";
import { getMediaBucket } from "../../../lib/cloudflare/bindings";
import { MediaUploadError, storeAdminMedia } from "../../../lib/cloudflare/media";

export const POST: APIRoute = ({ request }) => handleAdminRequest(request, async () => {
  if (!request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
    throw new AdminHttpError(415, "图片上传接口只接受 multipart/form-data。" );
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.name) {
    throw new AdminHttpError(400, "请选择要上传的图片。" );
  }
  try {
    return await storeAdminMedia(getMediaBucket(), file);
  } catch (error) {
    if (error instanceof MediaUploadError) throw new AdminHttpError(error.status, error.message);
    throw error;
  }
});
