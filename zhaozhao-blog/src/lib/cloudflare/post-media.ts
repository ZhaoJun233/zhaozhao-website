import {
  beginMediaUpload,
  completeMediaCleanup,
  failMediaCleanup,
  failMediaUpload,
  listMediaCleanupJobs,
  markMediaReady,
  type AdminMediaAsset,
} from "../database/media-repository";
import { createMediaKey, validatedImageExtension } from "./media";

export type PostImageOwner =
  | { draftToken: string; postId?: never }
  | { postId: string; draftToken?: never };

interface PostMediaMetadata {
  contentType: string;
  originalName: string;
  assetId: string;
}

export interface MediaObjectStore {
  put(key: string, value: ArrayBuffer, options?: { metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
}

export async function runMediaCleanup(
  database: D1Database,
  store: MediaObjectStore,
  limit = 10,
): Promise<{ completed: number; failed: number }> {
  const jobs = await listMediaCleanupJobs(database, limit);
  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      await store.delete(job.kv_key);
      await completeMediaCleanup(database, job.asset_id);
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failMediaCleanup(database, job.asset_id, message);
      failed += 1;
    }
  }

  return { completed, failed };
}

export async function uploadPostImage(
  database: D1Database,
  store: MediaObjectStore,
  file: File,
  owner: PostImageOwner,
): Promise<AdminMediaAsset> {
  const extension = validatedImageExtension(file);
  const key = createMediaKey(extension);
  const originalName = file.name.slice(0, 240);
  const contentType = file.type.toLowerCase();
  const asset = await beginMediaUpload(database, {
    key,
    originalName,
    contentType,
    sizeBytes: file.size,
    ...(owner.draftToken ? { draftToken: owner.draftToken } : {}),
  });
  try {
    await store.put(key, await file.arrayBuffer(), {
      metadata: {
        contentType,
        originalName,
        assetId: asset.id,
      } satisfies PostMediaMetadata,
    });
    return await markMediaReady(database, asset.id, owner.postId);
  } catch (error) {
    try {
      await failMediaUpload(database, asset.id);
    } catch {
      // Preserve the original upload failure if recovery also fails.
    }
    try {
      await runMediaCleanup(database, store);
    } catch {
      // Preserve the original upload failure if recovery also fails.
    }
    throw error;
  }
}
