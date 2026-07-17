import { randomUUID } from "node:crypto";
import { mediaUrlFromKey } from "../admin/post-images";
import { AdminConflictError, AdminNotFoundError } from "../admin/errors";
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
  draftToken?: string;
}

export interface BeginMediaUploadInput {
  key: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  draftToken?: string;
}

export interface BackfillMediaAssetInput {
  key: string;
  originalName: string;
  contentType: string;
  sizeBytes?: number;
}

export interface BackfillPostMediaInput {
  postId: string;
  coverKey?: string;
  inlineKeys: string[];
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
const maxD1BindingsPerStatement = 100;

function primary(database: D1Database): D1DatabaseSession {
  return database.withSession("first-primary");
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function chunks<T>(values: T[], size: number): T[][] {
  return Array.from(
    { length: Math.ceil(values.length / size) },
    (_, index) => values.slice(index * size, (index + 1) * size),
  );
}

async function findAssetRows(
  session: D1DatabaseSession,
  column: "id" | "kv_key",
  values: string[],
): Promise<AssetUsageRow[]> {
  const rows: AssetUsageRow[] = [];
  for (const bindings of chunks(values, maxD1BindingsPerStatement)) {
    const { results } = await session.prepare(
      `SELECT asset.*, link.usage,
         (SELECT COUNT(DISTINCT shared.post_id)
          FROM post_asset_links shared WHERE shared.asset_id = asset.id) AS shared_by
       FROM media_assets asset
       LEFT JOIN post_asset_links link ON link.asset_id = asset.id
       WHERE asset.${column} IN (${bindings.map(() => "?").join(", ")})
       ORDER BY asset.created_at, asset.id,
         CASE link.usage WHEN 'cover' THEN 0 WHEN 'inline' THEN 1 ELSE 2 END`,
    ).bind(...bindings).all<AssetUsageRow>();
    rows.push(...results);
  }
  return rows;
}

function uniqueAssetUsageRows(rows: AssetUsageRow[]): AssetUsageRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.id}\0${row.usage ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isConstraintError(error: unknown): boolean {
  return error instanceof Error && /constraint failed|SQLITE_CONSTRAINT/i.test(error.message);
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

export async function findRegisteredMediaKeys(
  database: D1Database,
  keys: string[],
): Promise<Set<string>> {
  const registered = new Set<string>();
  for (const bindings of chunks(unique(keys), maxD1BindingsPerStatement)) {
    const { results } = await primary(database).prepare(
      `SELECT kv_key FROM media_assets
       WHERE kv_key IN (${bindings.map(() => "?").join(", ")})`,
    ).bind(...bindings).all<{ kv_key: string }>();
    for (const { kv_key } of results) registered.add(kv_key);
  }
  return registered;
}

export async function registerAndLinkBackfilledPostMedia(
  database: D1Database,
  assets: BackfillMediaAssetInput[],
  posts: BackfillPostMediaInput[],
): Promise<{ registered: number; linked: number }> {
  const timestamp = new Date().toISOString();
  const { results: currentLinks } = await primary(database).prepare(
    `SELECT DISTINCT link.post_id, asset.kv_key
     FROM post_asset_links link
     JOIN media_assets asset ON asset.id = link.asset_id`,
  ).all<{ post_id: string; kv_key: string }>();
  const currentKeysByPost = new Map<string, Set<string>>();
  for (const link of currentLinks) {
    const keys = currentKeysByPost.get(link.post_id) ?? new Set<string>();
    keys.add(link.kv_key);
    currentKeysByPost.set(link.post_id, keys);
  }
  let linked = 0;
  for (const post of posts) {
    const desiredKeys = unique([
      ...(post.coverKey ? [post.coverKey] : []),
      ...post.inlineKeys,
    ]);
    if (desiredKeys.length === 0) continue;
    const currentKeys = currentKeysByPost.get(post.postId) ?? new Set<string>();
    linked += desiredKeys.filter((key) => !currentKeys.has(key)).length;
  }
  const assetIds = new Map(assets.map((asset) => [asset.key, randomUUID()]));
  const statements: D1PreparedStatement[] = assets.map((asset) => database.prepare(
    `INSERT INTO media_assets
     (id, kv_key, original_name, content_type, size_bytes, state, draft_token, created_at)
     VALUES (?, ?, ?, ?, ?, 'ready', NULL, ?)
     ON CONFLICT(kv_key) DO NOTHING`,
  ).bind(
    assetIds.get(asset.key)!,
    asset.key,
    asset.originalName,
    asset.contentType,
    asset.sizeBytes ?? null,
    timestamp,
  ));

  const referencedKeys = unique(posts.flatMap((post) => [
    ...(post.coverKey ? [post.coverKey] : []),
    ...post.inlineKeys,
  ]));
  for (const key of referencedKeys) {
    statements.push(database.prepare(
      "UPDATE media_assets SET state = 'ready', draft_token = NULL WHERE kv_key = ?",
    ).bind(key));
  }

  for (const post of posts) {
    const libraryKeys = unique([
      ...(post.coverKey ? [post.coverKey] : []),
      ...post.inlineKeys,
    ]);
    statements.push(
      database.prepare(
        "DELETE FROM post_asset_links WHERE post_id = ?",
      ).bind(post.postId),
    );
    for (const [sortOrder, key] of libraryKeys.entries()) {
      statements.push(database.prepare(
        `INSERT INTO post_asset_links (post_id, asset_id, usage, sort_order, created_at)
         SELECT ?, id, 'library', ?, ? FROM media_assets
         WHERE kv_key = ? AND state = 'ready'
         ON CONFLICT(post_id, asset_id, usage) DO UPDATE SET sort_order = excluded.sort_order`,
      ).bind(post.postId, sortOrder, timestamp, key));
    }
    if (post.coverKey) {
      statements.push(database.prepare(
        `INSERT INTO post_asset_links (post_id, asset_id, usage, sort_order, created_at)
         SELECT ?, id, 'cover', 0, ? FROM media_assets
         WHERE kv_key = ? AND state = 'ready'`,
      ).bind(post.postId, timestamp, post.coverKey));
    }
    for (const [sortOrder, key] of post.inlineKeys.entries()) {
      statements.push(database.prepare(
        `INSERT INTO post_asset_links (post_id, asset_id, usage, sort_order, created_at)
         SELECT ?, id, 'inline', ?, ? FROM media_assets
         WHERE kv_key = ? AND state = 'ready'
         ON CONFLICT(post_id, asset_id, usage) DO UPDATE SET sort_order = excluded.sort_order`,
      ).bind(post.postId, sortOrder, timestamp, key));
    }
  }
  for (const key of referencedKeys) {
    statements.push(database.prepare(
      "DELETE FROM media_cleanup_jobs WHERE kv_key = ?",
    ).bind(key));
  }

  const results = statements.length === 0 ? [] : await database.batch(statements);
  return {
    registered: assets.reduce(
      (count, _asset, index) => count + Number(results[index]?.meta.changes ?? 0),
      0,
    ),
    linked,
  };
}

export async function assertPostExists(
  database: D1Database,
  postId: string,
): Promise<void> {
  const post = await primary(database).prepare(
    "SELECT id FROM posts WHERE id = ?",
  ).bind(postId).first<{ id: string }>();
  if (!post) throw new AdminNotFoundError("文章不存在。");
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
       VALUES (?, (
         SELECT asset.id FROM media_assets asset
         WHERE asset.id = ? AND asset.state = 'ready'
       ), 'library', 0, ?)
       ON CONFLICT(post_id, asset_id, usage) DO NOTHING`,
    ).bind(postId, assetId, timestamp));
  }
  let results: D1Result[];
  try {
    results = await database.batch(statements);
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    throw new AdminConflictError("待删除图片不能重新使用。", { assetId });
  }
  if (Number(results[0]?.meta.changes ?? 0) !== 1) {
    throw new AdminConflictError("待删除图片不能重新使用。", { assetId });
  }
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

export async function discardMediaUpload(
  database: D1Database,
  assetId: string,
): Promise<void> {
  const result = await database.prepare(
    "DELETE FROM media_assets WHERE id = ? AND state = 'uploading'",
  ).bind(assetId).run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    throw new AdminConflictError("上传记录状态已变更，不能直接移除。", { assetId });
  }
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

  const session = primary(database);
  const results = uniqueAssetUsageRows([
    ...await findAssetRows(session, "id", requestedIds),
    ...await findAssetRows(session, "kv_key", requestedKeys),
  ]);

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
    ...(input.draftToken ? { draftToken: input.draftToken } : {}),
  };
}

export function buildPostAssetSyncStatements(
  database: D1Database,
  postId: string,
  resolved: ResolvedPostAssetSync,
  now: Date,
): D1PreparedStatement[] {
  const timestamp = now.toISOString();
  const draftToken = resolved.draftToken ?? null;
  let libraryIndex = 0;
  const libraryStatements = chunks(
    resolved.libraryAssetIds,
    Math.floor(maxD1BindingsPerStatement / 5),
  ).map((assetIds) => {
    const bindings: D1Value[] = [];
    const values = assetIds.map((assetId) => {
      bindings.push(postId, assetId, draftToken, libraryIndex++, timestamp);
      return `(?, (
        SELECT asset.id FROM media_assets asset
        WHERE asset.id = ? AND asset.state = 'ready'
          AND (asset.draft_token IS NULL OR asset.draft_token = ?)
      ), 'library', ?, ?)`;
    });
    return database.prepare(
      `INSERT INTO post_asset_links (post_id, asset_id, usage, sort_order, created_at)
       VALUES ${values.join(", ")}`,
    ).bind(...bindings);
  });
  let inlineIndex = 0;
  const inlineStatements = chunks(
    resolved.inlineAssetIds,
    Math.floor(maxD1BindingsPerStatement / 4),
  ).map((assetIds) => {
    const bindings: D1Value[] = [];
    const values = assetIds.map((assetId) => {
      bindings.push(postId, assetId, inlineIndex++, timestamp);
      return "(?, ?, 'inline', ?, ?)";
    });
    return database.prepare(
      `INSERT INTO post_asset_links (post_id, asset_id, usage, sort_order, created_at)
       VALUES ${values.join(", ")}`,
    ).bind(...bindings);
  });
  const clearDraftStatements = chunks(
    resolved.clearDraftAssetIds,
    maxD1BindingsPerStatement - 1,
  ).map((assetIds) => database.prepare(
    `UPDATE media_assets SET draft_token = NULL
     WHERE draft_token = ? AND id IN (${assetIds.map(() => "?").join(", ")})`,
  ).bind(draftToken, ...assetIds));
  return [
    database.prepare("DELETE FROM post_asset_links WHERE post_id = ?").bind(postId),
    ...libraryStatements,
    ...(resolved.coverAssetId ? [database.prepare(
      `INSERT INTO post_asset_links (post_id, asset_id, usage, sort_order, created_at)
       VALUES (?, ?, 'cover', 0, ?)`,
    ).bind(postId, resolved.coverAssetId, timestamp)] : []),
    ...inlineStatements,
    ...clearDraftStatements,
  ];
}

export async function syncPostAssetLinks(
  database: D1Database,
  postId: string,
  input: PostAssetSyncInput,
): Promise<AdminMediaAsset[]> {
  const resolved = await resolvePostAssetSync(database, input);
  try {
    await database.batch(buildPostAssetSyncStatements(database, postId, resolved, new Date()));
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    throw new AdminConflictError("图片状态或归属已变更，请重新保存。", {
      assetIds: resolved.libraryAssetIds,
    });
  }
  return listPostAssets(database, postId);
}

export async function removePostAsset(
  database: D1Database,
  postId: string,
  assetId: string,
): Promise<void> {
  const timestamp = new Date().toISOString();
  const [usageResult, , , removeResult] = await database.batch<{ usage: PostAssetUsage }>([
    database.prepare(
      `SELECT usage FROM post_asset_links
       WHERE post_id = ? AND asset_id = ?
       ORDER BY CASE usage WHEN 'cover' THEN 0 WHEN 'inline' THEN 1 ELSE 2 END`,
    ).bind(postId, assetId),
    database.prepare(
      `INSERT INTO media_cleanup_jobs (asset_id, kv_key, reason, queued_at)
       SELECT asset.id, asset.kv_key, 'manual_remove', ?
       FROM media_assets asset
       WHERE asset.id = ?
         AND EXISTS (
           SELECT 1 FROM post_asset_links target
           WHERE target.post_id = ? AND target.asset_id = asset.id
             AND target.usage = 'library'
         )
         AND NOT EXISTS (
           SELECT 1 FROM post_asset_links other
           WHERE other.asset_id = asset.id
             AND (other.post_id <> ? OR other.usage <> 'library')
         )
       ON CONFLICT(asset_id) DO NOTHING`,
    ).bind(timestamp, assetId, postId, postId),
    database.prepare(
      `UPDATE media_assets SET state = 'pending_delete'
       WHERE id = ?
         AND EXISTS (
           SELECT 1 FROM post_asset_links target
           WHERE target.post_id = ? AND target.asset_id = ? AND target.usage = 'library'
         )
         AND NOT EXISTS (
           SELECT 1 FROM post_asset_links other
           WHERE other.asset_id = ?
             AND (other.post_id <> ? OR other.usage <> 'library')
         )`,
    ).bind(assetId, postId, assetId, assetId, postId),
    database.prepare(
      `DELETE FROM post_asset_links
       WHERE post_id = ? AND asset_id = ? AND usage = 'library'
         AND NOT EXISTS (
           SELECT 1 FROM post_asset_links active
           WHERE active.post_id = ? AND active.asset_id = ?
             AND active.usage IN ('cover', 'inline')
         )`,
    ).bind(postId, assetId, postId, assetId),
  ]);
  const usages = usageResult?.results.map(({ usage }) => usage) ?? [];
  if (usages.length === 0) throw new AdminNotFoundError("图片不属于当前文章。");
  const activeUsages = usages.filter(
    (usage): usage is "cover" | "inline" => usage !== "library",
  );
  if (activeUsages.length > 0) {
    throw new AdminConflictError("请先从封面或正文移除这张图片并保存文章。", {
      usages: activeUsages,
    });
  }
  if (Number(removeResult?.meta.changes ?? 0) !== 1) {
    throw new AdminNotFoundError("图片不属于当前文章。");
  }
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

export async function queuePostDelete(
  database: D1Database,
  postId: string,
): Promise<PostDeleteQueueResult> {
  const timestamp = new Date().toISOString();
  const [countResult, , cleanupResult, deleteResult] = await database.batch<{
    exclusive: number;
    shared: number;
  }>([
    database.prepare(
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
    ).bind(postId, postId, postId),
    database.prepare(
      `UPDATE media_assets SET state = 'pending_delete'
       WHERE id IN (
         SELECT link.asset_id FROM post_asset_links link
         WHERE link.post_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM post_asset_links other
             WHERE other.asset_id = link.asset_id
               AND other.post_id <> ?
           )
       )`,
    ).bind(postId, postId),
    database.prepare(
      `INSERT INTO media_cleanup_jobs (asset_id, kv_key, reason, queued_at)
       SELECT DISTINCT asset.id, asset.kv_key, 'article_delete', ?
       FROM post_asset_links link
       JOIN media_assets asset ON asset.id = link.asset_id
       WHERE link.post_id = ?
         AND NOT EXISTS (
           SELECT 1 FROM post_asset_links other
           WHERE other.asset_id = link.asset_id
             AND other.post_id <> ?
         )
       ON CONFLICT(asset_id) DO NOTHING`,
    ).bind(timestamp, postId, postId),
    database.prepare("DELETE FROM posts WHERE id = ?").bind(postId),
  ]);
  if (Number(deleteResult?.meta.changes ?? 0) === 0) {
    throw new AdminNotFoundError("文章不存在。");
  }
  const counts = countResult?.results[0];
  return {
    deleted: true,
    exclusiveImages: Number(counts?.exclusive ?? 0),
    sharedImages: Number(counts?.shared ?? 0),
    cleanupPending: Number(cleanupResult?.meta.changes ?? 0),
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
