import { randomUUID } from "node:crypto";

export const maxMediaBytes = 5 * 1024 * 1024;
const extensionByType = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

export class MediaUploadError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "MediaUploadError";
  }
}

interface AdminMediaMetadata {
  contentType: string;
  originalName: string;
}

export function validatedImageExtension(file: File): "jpg" | "png" | "webp" | "gif" {
  const extension = extensionByType.get(file.type.toLowerCase());
  if (!extension) {
    throw new MediaUploadError(415, "图片格式必须是 JPEG、PNG、WebP 或 GIF。");
  }
  if (file.size === 0) throw new MediaUploadError(422, "图片文件是空的。");
  if (file.size > maxMediaBytes) throw new MediaUploadError(413, "图片不能超过 5 MiB。");
  return extension as "jpg" | "png" | "webp" | "gif";
}

export function createMediaKey(extension: string, now = new Date()): string {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `uploads/${year}/${month}/${randomUUID()}.${extension}`;
}

export async function storeAdminMedia(
  store: KVNamespace,
  file: File,
  now = new Date(),
): Promise<{ key: string; url: string }> {
  const extension = validatedImageExtension(file);
  const key = createMediaKey(extension, now);
  await store.put(key, await file.arrayBuffer(), {
    metadata: {
      contentType: file.type.toLowerCase(),
      originalName: file.name.slice(0, 240),
    } satisfies AdminMediaMetadata,
  });
  return { key, url: `/media/${key}/` };
}

export async function readAdminMedia(store: KVNamespace, key: string): Promise<Response> {
  if (!key.startsWith("uploads/") || key.includes("..") || key.includes("\\")) {
    return new Response("Not found", { status: 404 });
  }
  const object = await store.getWithMetadata<AdminMediaMetadata>(key, "arrayBuffer");
  if (!object.value) return new Response("Not found", { status: 404 });
  const immutableId = key.slice(key.lastIndexOf("/") + 1);
  return new Response(object.value, {
    headers: {
      ...(object.metadata?.contentType
        ? { "content-type": object.metadata.contentType }
        : {}),
      etag: `"${immutableId}"`,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
