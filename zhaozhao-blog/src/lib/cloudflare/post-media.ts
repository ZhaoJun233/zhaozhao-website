import {
  assertPostExists,
  beginMediaUpload,
  claimMediaCleanupJobs,
  completeMediaCleanup,
  discardMediaUpload,
  failMediaCleanup,
  failMediaUpload,
  markMediaReady,
  queueExpiredDraftCleanup,
  findRegisteredMediaKeys,
  registerAndLinkBackfilledPostMedia,
  type AdminMediaAsset,
  type BackfillMediaAssetInput,
} from "../database/media-repository";
import { extractManagedImageKeys, mediaKeyFromUrl } from "../admin/post-images";
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

export interface PostMediaBackfillStore extends MediaObjectStore {
  getWithMetadata<Metadata>(
    key: string,
    type: "arrayBuffer",
  ): Promise<{ value: ArrayBuffer | null; metadata: Metadata | null }>;
}

interface LegacyPostMediaMetadata {
  contentType?: string;
  originalName?: string;
}

interface LegacyPostRow {
  id: string;
  cover: string | null;
  body: string;
  published_at: string;
}

export interface PostMediaBackfillOptions {
  batchSize?: number;
}

export interface PostMediaBackfillResult {
  registered: number;
  linked: number;
  missing: string[];
  done?: boolean;
}

const contentTypeByExtension: Record<string, string> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function legacyMediaName(key: string): string {
  const basename = key.slice(key.lastIndexOf("/") + 1);
  try {
    return decodeURIComponent(basename).slice(0, 240);
  } catch {
    return basename.slice(0, 240);
  }
}

function legacyMediaContentType(key: string): string {
  const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  return contentTypeByExtension[extension] ?? "application/octet-stream";
}

export async function backfillPostMedia(
  database: D1Database,
  store: PostMediaBackfillStore,
  options?: PostMediaBackfillOptions,
): Promise<PostMediaBackfillResult> {
  const batchSize = options ? Math.max(1, Math.min(5, Math.floor(options.batchSize ?? 3))) : undefined;
  const state = batchSize === undefined ? undefined : await database.prepare(
    `SELECT cursor_published_at, cursor_post_id, completed
     FROM post_media_backfill_state WHERE id = 1`,
  ).first<{ cursor_published_at: string | null; cursor_post_id: string | null; completed: number }>();
  if (state?.completed) {
    return { registered: 0, linked: 0, missing: [], done: true };
  }
  const rowsResult = batchSize === undefined
    ? await database.prepare(
      "SELECT id, cover, body, published_at FROM posts ORDER BY published_at, id",
    ).all<LegacyPostRow>()
    : await database.prepare(
      `SELECT id, cover, body, published_at FROM posts
       WHERE ? IS NULL OR published_at > ? OR (published_at = ? AND id > ?)
       ORDER BY published_at, id LIMIT ?`,
    ).bind(
      state?.cursor_published_at ?? null,
      state?.cursor_published_at ?? "",
      state?.cursor_published_at ?? "",
      state?.cursor_post_id ?? "",
      batchSize,
    ).all<LegacyPostRow>();
  const rows = rowsResult.results;
  if (batchSize !== undefined && rows.length === 0) {
    await database.prepare(
      `UPDATE post_media_backfill_state
       SET completed = 1, updated_at = ? WHERE id = 1`,
    ).bind(new Date().toISOString()).run();
    return { registered: 0, linked: 0, missing: [], done: true };
  }
  const references = rows.map((post) => ({
    postId: post.id,
    coverKey: post.cover ? mediaKeyFromUrl(post.cover) : undefined,
    inlineKeys: extractManagedImageKeys(post.body),
    snapshotCover: post.cover,
    snapshotBody: post.body,
  }));
  const referencedKeys = [...new Set(references.flatMap((post) => [
    ...(post.coverKey ? [post.coverKey] : []),
    ...post.inlineKeys,
  ]))];
  const registeredKeys = await findRegisteredMediaKeys(database, referencedKeys);
  const claimedKeys = referencedKeys.length === 0
    ? new Set<string>()
    : new Set((await database.prepare(
      `SELECT kv_key FROM media_cleanup_jobs
       WHERE claim_token IS NOT NULL
         AND kv_key IN (SELECT value FROM json_each(?))`,
    ).bind(JSON.stringify(referencedKeys)).all<{ kv_key: string }>()).results
      .map(({ kv_key }) => kv_key));
  const missing: string[] = [];
  const assets: BackfillMediaAssetInput[] = [];
  for (const key of referencedKeys) {
    if (registeredKeys.has(key)) continue;
    const object = await store.getWithMetadata<LegacyPostMediaMetadata>(key, "arrayBuffer");
    if (!object.value) {
      missing.push(key);
      continue;
    }
    assets.push({
      key,
      originalName: object.metadata?.originalName?.slice(0, 240) || legacyMediaName(key),
      contentType: object.metadata?.contentType?.toLowerCase() || legacyMediaContentType(key),
      sizeBytes: object.value.byteLength,
    });
  }
  const availableKeys = new Set([
    ...[...registeredKeys].filter((key) => !claimedKeys.has(key)),
    ...assets.map(({ key }) => key),
  ]);
  const linkedReferences = references.map((post) => ({
    postId: post.postId,
    ...(post.coverKey && availableKeys.has(post.coverKey) ? { coverKey: post.coverKey } : {}),
    inlineKeys: post.inlineKeys.filter((key) => availableKeys.has(key)),
    snapshotCover: post.snapshotCover,
    snapshotBody: post.snapshotBody,
  }));
  if (options && claimedKeys.size > 0) {
    return { registered: 0, linked: 0, missing, done: false };
  }
  let result: { registered: number; linked: number };
  try {
    result = await registerAndLinkBackfilledPostMedia(database, assets, linkedReferences);
  } catch (error) {
    if (
      options
      && error instanceof Error
      && /media_operation_assertions\.value|NOT NULL constraint failed/i.test(error.message)
    ) {
      return { registered: 0, linked: 0, missing, done: false };
    }
    throw error;
  }
  const done = batchSize === undefined ? undefined : rows.length < batchSize;
  if (batchSize !== undefined) {
    const last = rows.at(-1)!;
    await database.prepare(
      `UPDATE post_media_backfill_state
       SET cursor_published_at = ?, cursor_post_id = ?, completed = ?, updated_at = ?
       WHERE id = 1`,
    ).bind(last.published_at, last.id, done ? 1 : 0, new Date().toISOString()).run();
  }
  return {
    ...result,
    missing,
    ...(options ? { done } : {}),
  };
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
  now = new Date(),
): Promise<{ completed: number; failed: number }> {
  await queueExpiredDraftCleanup(
    database,
    new Date(now.getTime() - 24 * 60 * 60 * 1000),
    limit,
  );
  const jobs = await claimMediaCleanupJobs(database, limit, now);
  let completed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      await store.delete(job.kv_key);
      await completeMediaCleanup(
        database,
        job.asset_id,
        job.claim_token!,
        job.claim_generation,
      );
      completed += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failMediaCleanup(
        database,
        job.asset_id,
        job.claim_token!,
        job.claim_generation,
        message,
      );
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
