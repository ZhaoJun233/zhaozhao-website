import {
  assertPostExists,
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

export interface MediaUploadRecoveryDetails {
  assetId: string;
  key: string;
  cleanupQueued: boolean;
  objectDeleted: boolean;
  cause: unknown;
  queueError?: unknown;
  deleteError?: unknown;
  discardError?: unknown;
  cleanupError?: unknown;
}

export class MediaUploadRecoveryError extends AggregateError {
  readonly assetId: string;
  readonly key: string;
  readonly cleanupQueued: boolean;
  readonly objectDeleted: boolean;
  override readonly cause: unknown;
  readonly queueError?: unknown;
  readonly deleteError?: unknown;
  readonly discardError?: unknown;
  readonly cleanupError?: unknown;

  constructor(message: string, details: MediaUploadRecoveryDetails) {
    const errors = [
      details.cause,
      details.queueError,
      details.deleteError,
      details.discardError,
      details.cleanupError,
    ].filter((error) => error !== undefined);
    super(errors, `${message} assetId=${details.assetId}; key=${details.key}`);
    this.name = "MediaUploadRecoveryError";
    this.assetId = details.assetId;
    this.key = details.key;
    this.cleanupQueued = details.cleanupQueued;
    this.objectDeleted = details.objectDeleted;
    this.cause = details.cause;
    this.queueError = details.queueError;
    this.deleteError = details.deleteError;
    this.discardError = details.discardError;
    this.cleanupError = details.cleanupError;
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

export type MediaCleanupRunner = typeof runMediaCleanup;

export async function runMediaCleanupBestEffort(
  database: D1Database,
  store: MediaObjectStore,
  limit = 10,
  cleanup: MediaCleanupRunner = runMediaCleanup,
): Promise<void> {
  try {
    await cleanup(database, store, limit);
  } catch (error) {
    console.error(error);
  }
}

export async function uploadPostImage(
  database: D1Database,
  store: MediaObjectStore,
  file: File,
  owner: PostImageOwner,
): Promise<AdminMediaAsset> {
  const extension = validatedImageExtension(file);
  if (owner.postId !== undefined) await assertPostExists(database, owner.postId);
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
        {
          assetId: asset.id,
          key,
          cleanupQueued: false,
          objectDeleted: false,
          cause: putError,
          discardError,
        },
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
      let objectDeleted = false;
      let deleteError: unknown;
      let discardError: unknown;
      try {
        await store.delete(key);
        objectDeleted = true;
      } catch (error) {
        deleteError = error;
      }
      if (objectDeleted) {
        try {
          await discardMediaUpload(database, asset.id);
        } catch (error) {
          discardError = error;
        }
      }
      throw new MediaUploadRecoveryError(
        "图片状态更新失败，且清理任务入队失败。",
        {
          assetId: asset.id,
          key,
          cleanupQueued: false,
          objectDeleted,
          cause: readyError,
          queueError,
          deleteError,
          discardError,
        },
      );
    }

    try {
      await runMediaCleanup(database, store);
    } catch (cleanupError) {
      throw new MediaUploadRecoveryError(
        "图片状态更新失败，且即时清理执行失败；清理任务已保留。",
        {
          assetId: asset.id,
          key,
          cleanupQueued: true,
          objectDeleted: false,
          cause: readyError,
          cleanupError,
        },
      );
    }
    throw readyError;
  }
}
