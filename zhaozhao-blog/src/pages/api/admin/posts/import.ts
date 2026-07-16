import type { APIRoute } from "astro";
import { AdminHttpError, handleAdminRequest } from "../../../../lib/admin/http";
import {
  maxMarkdownImportBytes,
  parseMarkdownPostImport,
} from "../../../../lib/admin/markdown-import";
import { createPost } from "../../../../lib/database/admin-repository";

export const POST: APIRoute = ({ request }) => handleAdminRequest(request, async (database) => {
  if (!request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
    throw new AdminHttpError(415, "导入接口只接受 Markdown 文件。" );
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !file.name) {
    throw new AdminHttpError(400, "请选择要导入的 Markdown 文件。" );
  }
  if (file.size > maxMarkdownImportBytes) {
    throw new AdminHttpError(413, "Markdown 文件不能超过 2 MiB。" );
  }
  return createPost(database, parseMarkdownPostImport(file.name, await file.text()));
});
