import { randomUUID } from "node:crypto";
import { mediaUrlFromKey } from "../admin/post-images";
import { AdminConflictError, AdminNotFoundError } from "./admin-repository";
import type {
  MediaAssetRow,
  MediaCleanupJobRow,
  PostAssetUsage,
} from "./types";

export interface AdminMediaAsset {
  id: string;
  key: string;
  url: string;
  originalName: string;
  contentType: string;
  sizeBytes?: number;
  usages: Array<"library" | "cover" | "inline">;
  sharedBy: number;
}

export interface PostAssetSyncInput {
  draftToken?: string;
  retainedAssetIds: string[];
  coverAssetId?: string;
  inlineKeys: string[];
}

export interface ResolvedPostAssetSync {
  assets: AdminMediaAsset[];
  libraryAssetIds: string[];
  coverAssetId?: string;
  inlineAssetIds: string[];
  clearDraftAssetIds: string[];
}

export interface BeginMediaUploadInput {
  key: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  draftToken?: string;
}

export interface PostDeletePreview {
  exclusive: number;
  shared: number;
}

export interface PostDeleteQueueResult {
  deleted: true;
  exclusiveImages: number;
  sharedImages: number;
  cleanupPending: number;
}

interface AssetUsageRow extends MediaAssetRow {
  usage: PostAssetUsage | null;
  shared_by: number;
}

const usageOrder: PostAssetUsage[] = ["cover", "inline", "library"];

function primary(database: D1Database): D1DatabaseSession {
  return database.withSession("first-primary");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function assetFromRows(rows: AssetUsageRow[]): AdminMediaAsset {
  const row = rows[0]!;
  const usages = unique(
    rows.flatMap(({ usage }) => usage ? [usage] : []),
  ).sort((left, right) => usageOrder.indexOf(left) - usageOrder.indexOf(right));
  return {
    id: row.id,
    key: row.kv_key,
    url: mediaUrlFromKey(row.kv_key),
    originalName: row.original_name,
    contentType: row.content_type,
    ...(row.size_bytes === null ? {} : { sizeBytes: Number(row.size_bytes) }),
    usages,
    sharedBy: Number(row.shared_by),
  };
}

function assetsFromRows(rows: AssetUsageRow[]): AdminMediaAsset[] {
  const grouped = new Map<string, AssetUsageRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.id) ?? [];
    group.push(row);
    grouped.set(row.id, group);
  }
  return [...grouped.values()].map(assetFromRows);
}

async function getAssetRows(database: D1Database, assetId: string): Promise<AssetUsageRow[]> {
  const { results } = await primary(database).prepare(
    `SELECT asset.*, link.usage,
       (SELECT COUNT(DISTINCT shared.post_id)
        FROM post_asset_links shared WHERE shared.asset_id = asset.id) AS shared_by
     FROM media_assets asset
     LEFT JOIN post_asset_links link ON link.asset_id = asset.id
     WHERE asset.id = ?
     ORDER BY CASE link.usage WHEN 'cover' THEN 0 WHEN 'inline' THEN 1 ELSE 2 END`,
  ).bind(assetId).all<AssetUsageRow>();
  if (results.length === 0) throw new AdminNotFoundError("图片不存在。");
  return results;
}

export async function beginMediaUpload(
  database: D1Database,
  input: BeginMediaUploadInput,
): Promise<AdminMediaAsset> {
  mediaUrlFromKey(input.key);
  const id = randomUUID();
  await database.prepare(
    `INSERT INTO media_assets
     (id, kv_key, original_name, content_type, size_bytes, state, draft_token, created_at)
     VALUES (?, ?, ?, ?, ?, 'uploading', ?, ?)`,
  ).bind(
    id,
    input.key,
    input.originalName,
    input.contentType,
    input.sizeBytes,
    input.draftToken ?? null,
    new Date().toISOString(),
  ).run();
  return assetFromRows(await getAssetRows(database, id));
}

export async function markMediaReady(
  database: D1Database,
  assetId: string,
  postId?: string,
): Promise<AdminMediaAsset> {
  const current = (await getAssetRows(database, assetId))[0]!;
  if (current.state === "pending_delete") {
    throw new AdminConflictError("待删除图片不能重新使用。");
  }
  const timestamp = new Date().toISOString();
  const statements = [database.prepare(
    "UPDATE media_assets SET state = 'ready' WHERE id = ? AND state IN ('uploading', 'ready')",
  ).bind(assetId)];
  if (postId) {
    statements.push(database.prepare(
      `INSERT INTO post_asset_links (post_id, asset_id, usage, sort_order, created_at)
       VALUES (?, ?, 'library', 0, ?)
       ON CONFLICT(post_id, asset_id, usage) DO NOTHING`,
    ).bind(postId, assetId, timestamp));
  }
  await database.batch(statements);
  if (postId) {
    const attached = (await listPostAssets(database, postId))
      .find(({ id }) => id === assetId);
    if (!attached) throw new AdminNotFoundError("图片不存在。");
    return attached;
  }
  return assetFromRows(await getAssetRows(database, assetId));
}

export async function failMediaUpload(
  database: D1Database,
  assetId: string,
): Promise<void> {
  const timestamp = new Date().toISOString();
  await database.batch([
    database.prepare(
      `UPDATE media_assets SET state = 'pending_delete'
       WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM post_asset_links WHERE asset_id = ?)`,
    ).bind(assetId, assetId),
    database.prepare(
      `INSERT INTO media_cleanup_jobs (asset_id, kv_key, reason, queued_at)
       SELECT asset.id, asset.kv_key, 'upload_failed', ?
       FROM media_assets asset
       WHERE asset.id = ? AND asset.state = 'pending_delete'
         AND NOT EXISTS (SELECT 1 FROM post_asset_links WHERE asset_id = asset.id)
       ON CONFLICT(asset_id) DO NOTHING`,
    ).bind(timestamp, assetId),
  ]);
}

export async function listPostAssets(
  database: D1Database,
  postId: string,
): Promise<AdminMediaAsset[]> {
  const { results } = await primary(database).prepare(
    `SELECT asset.*, link.usage,
       (SELECT COUNT(DISTINCT shared.post_id)
        FROM post_asset_links shared
        WHERE shared.asset_id = asset.id AND shared.post_id <> ?) AS shared_by
     FROM post_asset_links link
     JOIN media_assets asset ON asset.id = link.asset_id
     WHERE link.post_id = ?
     ORDER BY asset.created_at, asset.id,
       CASE link.usage WHEN 'cover' THEN 0 WHEN 'inline' THEN 1 ELSE 2 END`,
  ).bind(postId, postId).all<AssetUsageRow>();
  return assetsFromRows(results);
}

export async function resolvePostAssetSync(
  database: D1Database,
  input: PostAssetSyncInput,
): Promise<ResolvedPostAssetSync> {
  const requestedIds = unique([
    ...input.retainedAssetIds,
    ...(input.coverAssetId ? [input.coverAssetId] : []),
  ]);
  const requestedKeys = unique(input.inlineKeys);
  if (requestedIds.length === 0 && requestedKeys.length === 0) {
    return {
      assets: [],
      libraryAssetIds: [],
      inlineAssetIds: [],
      clearDraftAssetIds: [],
    };
  }

  const clauses: string[] = [];
  const bindings: string[] = [];
  if (requestedIds.length > 0) {
    clauses.push(`asset.id IN (${requestedIds.map(() => "?").join(", ")})`);
    bindings.push(...requestedIds);
  }
  if (requestedKeys.length > 0) {
    clauses.push(`asset.kv_key IN (${requestedKeys.map(() => "?").join(", ")})`);
    bindings.push(...requestedKeys);
  }
  const { results } = await primary(database).prepare(
    `SELECT asset.*, link.usage,
       (SELECT COUNT(DISTINCT shared.post_id)
        FROM post_asset_links shared WHERE shared.asset_id = asset.id) AS shared_by
     FROM media_assets asset
     LEFT JOIN post_asset_links link ON link.asset_id = asset.id
     WHERE ${clauses.join(" OR ")}
     ORDER BY asset.created_at, asset.id,
       CASE link.usage WHEN 'cover' THEN 0 WHEN 'inline' THEN 1 ELSE 2 END`,
  ).bind(...bindings).all<AssetUsageRow>();

  const assets = assetsFromRows(results);
  const rowsById = new Map(results.map((row) => [row.id, row]));
  const rowsByKey = new Map(results.map((row) => [row.kv_key, row]));
  for (const id of requestedIds) {
    if (!rowsById.has(id)) throw new AdminNotFoundError("图片不存在。");
  }
  for (const key of requestedKeys) {
    if (!rowsByKey.has(key)) throw new AdminNotFoundError("图片不存在。");
  }

  const requestedRows = unique([
    ...requestedIds,
    ...requestedKeys.map((key) => rowsByKey.get(key)!.id),
  ]).map((id) => rowsById.get(id)!);
  for (const row of requestedRows) {
    if (row.state !== "ready") {
      throw new AdminConflictError("图片尚未就绪或正在删除。", { assetId: row.id });
    }
    if (row.draft_token !== null && row.draft_token !== (input.draftToken ?? null)) {
      throw new AdminConflictError("临时图片不属于当前编辑会话。", { assetId: row.id });
    }
  }

  const retainedAssetIds = input.retainedAssetIds.map((id) => rowsById.get(id)!.id);
  const inlineAssetIds = unique(input.inlineKeys.map((key) => rowsByKey.get(key)!.id));
  const coverAssetId = input.coverAssetId
    ? rowsById.get(input.coverAssetId)!.id
    : undefined;
  const libraryAssetIds = unique([
    ...retainedAssetIds,
    ...(coverAssetId ? [coverAssetId] : []),
    ...inlineAssetIds,
  ]);
  const selectedAssets = libraryAssetIds.map((id) => assets.find((asset) => asset.id === id)!);
  const clearDraftAssetIds = input.draftToken
    ? requestedRows
      .filter(({ draft_token }) => draft_token === input.draftToken)
      .map(({ id }) => id)
    : [];
  return {
    assets: selectedAssets,
    libraryAssetIds,
    ...(coverAssetId ? { coverAssetId } : {}),
    inlineAssetIds,
    clearDraftAssetIds: unique(clearDraftAssetIds),
  };
}

export function buildPostAssetSyncStatements(
  database: D1Database,
  postId: string,
  resolved: ResolvedPostAssetSync,
  now: Date,
): D1PreparedStatement[] {
  const timestamp = now.toISOString();
  return [
    database.prepare("DELETE FROM post_asset_links WHERE post_id = ?").bind(postId),
    ...resolved.libraryAssetIds.map((assetId, index) => database.prepare(
      `INSERT INTO post_asset_links (post_id, asset_id, usage, sort_order, created_at)
       VALUES (?, ?, 'library', ?, ?)`,
    ).bind(postId, assetId, index, timestamp)),
    ...(resolved.coverAssetId ? [database.prepare(
      `INSERT INTO post_asset_links (post_id, asset_id, usage, sort_order, created_at)
       VALUES (?, ?, 'cover', 0, ?)`,
    ).bind(postId, resolved.coverAssetId, timestamp)] : []),
    ...resolved.inlineAssetIds.map((assetId, index) => database.prepare(
      `INSERT INTO post_asset_links (post_id, asset_id, usage, sort_order, created_at)
       VALUES (?, ?, 'inline', ?, ?)`,
    ).bind(postId, assetId, index, timestamp)),
    ...resolved.clearDraftAssetIds.map((assetId) => database.prepare(
      "UPDATE media_assets SET draft_token = NULL WHERE id = ?",
    ).bind(assetId)),
  ];
}

export async function syncPostAssetLinks(
  database: D1Database,
  postId: string,
  input: PostAssetSyncInput,
): Promise<AdminMediaAsset[]> {
  const resolved = await resolvePostAssetSync(database, input);
  await database.batch(buildPostAssetSyncStatements(database, postId, resolved, new Date()));
  return listPostAssets(database, postId);
}

export async function removePostAsset(
  database: D1Database,
  postId: string,
  assetId: string,
): Promise<void> {
  const { results } = await primary(database).prepare(
    `SELECT usage FROM post_asset_links
     WHERE post_id = ? AND asset_id = ?
     ORDER BY CASE usage WHEN 'cover' THEN 0 WHEN 'inline' THEN 1 ELSE 2 END`,
  ).bind(postId, assetId).all<{ usage: PostAssetUsage }>();
  if (results.length === 0) throw new AdminNotFoundError("图片不属于当前文章。");
  const activeUsages = results
    .map(({ usage }) => usage)
    .filter((usage): usage is "cover" | "inline" => usage !== "library");
  if (activeUsages.length > 0) {
    throw new AdminConflictError("请先从封面或正文移除这张图片并保存文章。", {
      usages: activeUsages,
    });
  }

  const timestamp = new Date().toISOString();
  await database.batch([
    database.prepare(
      "DELETE FROM post_asset_links WHERE post_id = ? AND asset_id = ? AND usage = 'library'",
    ).bind(postId, assetId),
    database.prepare(
      `UPDATE media_assets SET state = 'pending_delete'
       WHERE id = ?
         AND NOT EXISTS (SELECT 1 FROM post_asset_links WHERE asset_id = ?)`,
    ).bind(assetId, assetId),
    database.prepare(
      `INSERT INTO media_cleanup_jobs (asset_id, kv_key, reason, queued_at)
       SELECT asset.id, asset.kv_key, 'manual_remove', ?
       FROM media_assets asset
       WHERE asset.id = ? AND asset.state = 'pending_delete'
         AND NOT EXISTS (SELECT 1 FROM post_asset_links WHERE asset_id = asset.id)
       ON CONFLICT(asset_id) DO NOTHING`,
    ).bind(timestamp, assetId),
  ]);
}

export async function previewPostDelete(
  database: D1Database,
  postId: string,
): Promise<PostDeletePreview> {
  const row = await primary(database).prepare(
    `SELECT
       COUNT(DISTINCT CASE WHEN NOT EXISTS (
         SELECT 1 FROM post_asset_links other
         WHERE other.asset_id = link.asset_id AND other.post_id <> ?
       ) THEN link.asset_id END) AS exclusive,
       COUNT(DISTINCT CASE WHEN EXISTS (
         SELECT 1 FROM post_asset_links other
         WHERE other.asset_id = link.asset_id AND other.post_id <> ?
       ) THEN link.asset_id END) AS shared
     FROM post_asset_links link
     WHERE link.post_id = ?`,
  ).bind(postId, postId, postId).first<{ exclusive: number; shared: number }>();
  return {
    exclusive: Number(row?.exclusive ?? 0),
    shared: Number(row?.shared ?? 0),
  };
}

export async function listMediaCleanupJobs(
  database: D1Database,
  limit = 10,
): Promise<MediaCleanupJobRow[]> {
  const normalizedLimit = Math.max(0, Math.floor(limit));
  const { results } = await primary(database).prepare(
    `SELECT * FROM media_cleanup_jobs
     ORDER BY queued_at, asset_id
     LIMIT ?`,
  ).bind(normalizedLimit).all<MediaCleanupJobRow>();
  return results;
}

export async function completeMediaCleanup(
  database: D1Database,
  assetId: string,
): Promise<void> {
  await database.prepare(
    `DELETE FROM media_assets
     WHERE id = ?
       AND NOT EXISTS (SELECT 1 FROM post_asset_links WHERE asset_id = ?)`,
  ).bind(assetId, assetId).run();
}

export async function failMediaCleanup(
  database: D1Database,
  assetId: string,
  message: string,
): Promise<void> {
  await database.prepare(
    `UPDATE media_cleanup_jobs
     SET attempts = attempts + 1, last_error = ?
     WHERE asset_id = ?`,
  ).bind(message, assetId).run();
}

export async function queueDraftCleanup(
  database: D1Database,
  token: string,
  reason: "draft_cancelled" | "draft_expired",
): Promise<number> {
  const timestamp = new Date().toISOString();
  const results = await database.batch([
    database.prepare(
      `UPDATE media_assets SET state = 'pending_delete'
       WHERE draft_token = ? AND state <> 'pending_delete'
         AND NOT EXISTS (
           SELECT 1 FROM post_asset_links WHERE asset_id = media_assets.id
         )`,
    ).bind(token),
    database.prepare(
      `INSERT INTO media_cleanup_jobs (asset_id, kv_key, reason, queued_at)
       SELECT asset.id, asset.kv_key, ?, ?
       FROM media_assets asset
       WHERE asset.draft_token = ? AND asset.state = 'pending_delete'
         AND NOT EXISTS (SELECT 1 FROM post_asset_links WHERE asset_id = asset.id)
       ON CONFLICT(asset_id) DO NOTHING`,
    ).bind(reason, timestamp, token),
  ]);
  return Number(results[1]?.meta.changes ?? 0);
}

export type { MediaCleanupJobRow };
