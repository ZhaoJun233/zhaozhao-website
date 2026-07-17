import {
  beginMediaUpload,
  completeMediaCleanup,
  discardMediaUpload,
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

export class MediaUploadRecoveryError extends AggregateError {
  constructor(message: string, errors: unknown[]) {
    super(errors, message);
    this.name = "MediaUploadRecoveryError";
  }
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
    ...(owner.draftToken !== undefined ? { draftToken: owner.draftToken } : {}),
  });

  try {
    await store.put(key, await file.arrayBuffer(), {
      metadata: {
        contentType,
        originalName,
        assetId: asset.id,
      } satisfies PostMediaMetadata,
    });
  } catch (putError) {
    try {
      await discardMediaUpload(database, asset.id);
    } catch (discardError) {
      throw new MediaUploadRecoveryError(
        "图片写入失败，且上传记录清理失败。",
        [putError, discardError],
      );
    }
    throw putError;
  }

  try {
    return await markMediaReady(database, asset.id, owner.postId);
  } catch (readyError) {
    try {
      await failMediaUpload(database, asset.id);
    } catch (queueError) {
      const recoveryErrors: unknown[] = [readyError, queueError];
      let objectDeleted = false;
      try {
        await store.delete(key);
        objectDeleted = true;
      } catch (deleteError) {
        recoveryErrors.push(deleteError);
      }
      if (objectDeleted) {
        try {
          await discardMediaUpload(database, asset.id);
        } catch (discardError) {
          recoveryErrors.push(discardError);
        }
      }
      throw new MediaUploadRecoveryError(
        "图片状态更新失败，且清理任务入队失败。",
        recoveryErrors,
      );
    }

    try {
      await runMediaCleanup(database, store);
    } catch (cleanupError) {
      throw new MediaUploadRecoveryError(
        "图片状态更新失败，且即时清理执行失败；清理任务已保留。",
        [readyError, cleanupError],
      );
    }
    throw readyError;
  }
}
