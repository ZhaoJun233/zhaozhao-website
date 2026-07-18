import { randomUUID } from "node:crypto";
import { z } from "astro/zod";
import {
  categoryInputSchema,
  friendInputSchema,
  postInputSchema,
  projectInputSchema,
  settingSchemas,
  type CategoryInput,
  type FriendInput,
  type PostInput,
  type PostMediaInput,
  type ProjectInput,
  type SettingKey,
} from "../admin/schemas";
import { AdminConflictError, AdminNotFoundError } from "../admin/errors";
import { extractManagedImageKeys, mediaKeyFromUrl, mediaUrlFromKey } from "../admin/post-images";
import { taxonomySlug } from "../slug";
import type { CategoryRow, FriendRow, PostRow, ProjectRow } from "./types";
import { listAdminMessages, type AdminMessage } from "./message-repository";
import {
  buildPostAssetSyncStatements,
  resolvePostAssetSync,
  type ResolvedPostAssetSync,
} from "./media-repository";
import {
  listMusicTracks,
  neteaseEmbedUrl,
  neteaseSongUrl,
  type AdminMusicTrack,
} from "./music-repository";

export { AdminConflictError, AdminNotFoundError } from "../admin/errors";

export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  description?: string;
  sortOrder: number;
  enabled: boolean;
}

export interface AdminFriend {
  id: string;
  name: string;
  url: string;
  description: string;
  interests: string[];
  sortOrder: number;
  enabled: boolean;
  updatedAt: string;
}

export interface AdminPost {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  publishedAt: string;
  updatedAt?: string;
  draft: boolean;
  category: string;
  tags: string[];
  cover?: string;
  coverAlt?: string;
  featured: boolean;
  series?: string;
  canonicalUrl?: string;
}

export interface AdminProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  date: string;
  status: "active" | "completed" | "archived";
  tags: string[];
  cover?: string;
  repositoryUrl?: string;
  demoUrl?: string;
  featured: boolean;
  sortOrder: number;
}

function categoryFromRow(row: CategoryRow): AdminCategory {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    ...(row.description ? { description: row.description } : {}),
    sortOrder: row.sort_order,
    enabled: Boolean(row.enabled),
  };
}

function friendFromRow(row: FriendRow): AdminFriend {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    description: row.description,
    interests: JSON.parse(row.interests_json) as string[],
    sortOrder: row.sort_order,
    enabled: Boolean(row.enabled),
    updatedAt: row.updated_at,
  };
}

function postFromRow(row: PostRow): AdminPost {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    body: row.body,
    publishedAt: row.published_at,
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
    draft: Boolean(row.draft),
    category: row.category,
    tags: JSON.parse(row.tags_json) as string[],
    ...(row.cover ? { cover: row.cover } : {}),
    ...(row.cover_alt ? { coverAlt: row.cover_alt } : {}),
    featured: Boolean(row.featured),
    ...(row.series ? { series: row.series } : {}),
    ...(row.canonical_url ? { canonicalUrl: row.canonical_url } : {}),
  };
}

function projectFromRow(row: ProjectRow): AdminProject {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    body: row.body,
    date: row.project_date,
    status: row.status,
    tags: JSON.parse(row.tags_json) as string[],
    ...(row.cover ? { cover: row.cover } : {}),
    ...(row.repository_url ? { repositoryUrl: row.repository_url } : {}),
    ...(row.demo_url ? { demoUrl: row.demo_url } : {}),
    featured: Boolean(row.featured),
    sortOrder: row.sort_order,
  };
}

async function firstRequired<T>(
  statement: D1PreparedStatement,
  message: string,
): Promise<T> {
  const value = await statement.first<T>();
  if (!value) throw new AdminNotFoundError(message);
  return value;
}

async function nextOrder(
  database: D1DatabaseSession,
  table: "categories" | "friends" | "projects",
): Promise<number> {
  const row = await database.prepare(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM ${table}`,
  ).first<{ value: number }>();
  return Number(row?.value ?? 0);
}

function primary(database: D1Database): D1DatabaseSession {
  return database.withSession("first-primary");
}

export async function listCategories(database: D1Database): Promise<AdminCategory[]> {
  const { results } = await primary(database).prepare(
    "SELECT * FROM categories ORDER BY sort_order, name",
  ).all<CategoryRow>();
  return results.map(categoryFromRow);
}

export async function createCategory(
  database: D1Database,
  input: CategoryInput,
): Promise<AdminCategory> {
  const value = categoryInputSchema.parse(input);
  const id = randomUUID();
  const session = primary(database);
  await session.prepare(
    `INSERT INTO categories (id, name, slug, description, sort_order, enabled)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id, value.name, taxonomySlug(value.name), value.description ?? null,
    await nextOrder(session, "categories"), value.enabled ? 1 : 0).run();
  return getCategory(database, id);
}

export async function getCategory(database: D1Database, id: string): Promise<AdminCategory> {
  return categoryFromRow(await firstRequired<CategoryRow>(
    primary(database).prepare("SELECT * FROM categories WHERE id = ?").bind(id),
    "分类不存在。",
  ));
}

export async function updateCategory(
  database: D1Database,
  id: string,
  input: CategoryInput,
): Promise<AdminCategory> {
  const current = await getCategory(database, id);
  const value = categoryInputSchema.parse(input);
  const statements = [database.prepare(
    "UPDATE categories SET name = ?, slug = ?, description = ?, enabled = ? WHERE id = ?",
  ).bind(value.name, taxonomySlug(value.name), value.description ?? null, value.enabled ? 1 : 0, id)];
  if (current.name !== value.name) {
    statements.push(database.prepare(
      "UPDATE posts SET category = ? WHERE category = ?",
    ).bind(value.name, current.name));
  }
  await database.batch(statements);
  return getCategory(database, id);
}

export async function deleteCategory(database: D1Database, id: string): Promise<void> {
  const category = await getCategory(database, id);
  const references = await primary(database).prepare(
    "SELECT COUNT(*) AS count FROM posts WHERE category = ?",
  ).bind(category.name).first<{ count: number }>();
  if (Number(references?.count ?? 0) > 0) {
    throw new AdminConflictError("该分类仍被文章使用。", {
      references: Number(references?.count ?? 0),
    });
  }
  await database.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();
}

export async function listFriends(database: D1Database): Promise<AdminFriend[]> {
  const { results } = await primary(database).prepare(
    "SELECT * FROM friends ORDER BY sort_order, name",
  ).all<FriendRow>();
  return results.map(friendFromRow);
}

export async function getFriend(database: D1Database, id: string): Promise<AdminFriend> {
  return friendFromRow(await firstRequired<FriendRow>(
    primary(database).prepare("SELECT * FROM friends WHERE id = ?").bind(id),
    "友链不存在。",
  ));
}

export async function createFriend(database: D1Database, input: FriendInput): Promise<AdminFriend> {
  const value = friendInputSchema.parse(input);
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const session = primary(database);
  await session.prepare(
    `INSERT INTO friends
     (id, name, url, description, interests_json, sort_order, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, value.name, value.url, value.description, JSON.stringify(value.interests),
    await nextOrder(session, "friends"), value.enabled ? 1 : 0, timestamp).run();
  return getFriend(database, id);
}

export async function updateFriend(
  database: D1Database,
  id: string,
  input: FriendInput,
): Promise<AdminFriend> {
  await getFriend(database, id);
  const value = friendInputSchema.parse(input);
  await database.prepare(
    `UPDATE friends SET name = ?, url = ?, description = ?, interests_json = ?,
     enabled = ?, updated_at = ? WHERE id = ?`,
  ).bind(value.name, value.url, value.description, JSON.stringify(value.interests),
    value.enabled ? 1 : 0, new Date().toISOString(), id).run();
  return getFriend(database, id);
}

export async function deleteFriend(database: D1Database, id: string): Promise<void> {
  const result = await database.prepare("DELETE FROM friends WHERE id = ?").bind(id).run();
  if ((result.meta.changes ?? 0) === 0) throw new AdminNotFoundError("友链不存在。");
}

export async function orderFriends(database: D1Database, ids: string[]): Promise<AdminFriend[]> {
  const current = (await listFriends(database)).map(({ id }) => id).sort();
  if (ids.length !== current.length || [...ids].sort().some((id, index) => id !== current[index])) {
    throw new AdminConflictError("排序列表必须包含全部友链。" );
  }
  await database.batch(ids.map((id, index) => database.prepare(
    "UPDATE friends SET sort_order = ? WHERE id = ?",
  ).bind(index, id)));
  return listFriends(database);
}

export async function listPosts(database: D1Database): Promise<AdminPost[]> {
  const { results } = await primary(database).prepare(
    "SELECT * FROM posts ORDER BY published_at DESC, slug",
  ).all<PostRow>();
  return results.map(postFromRow);
}

export async function getPost(database: D1Database, id: string): Promise<AdminPost> {
  return postFromRow(await firstRequired<PostRow>(
    primary(database).prepare("SELECT * FROM posts WHERE id = ?").bind(id),
    "文章不存在。",
  ));
}

function createPostStatement(
  database: D1Database | D1DatabaseSession,
  id: string,
  value: ReturnType<typeof postInputSchema.parse>,
  cover = value.cover,
): D1PreparedStatement {
  return database.prepare(
    `INSERT INTO posts
     (id, slug, title, description, body, published_at, updated_at, draft, category,
      tags_json, cover, cover_alt, featured, series, canonical_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, value.slug, value.title, value.description, value.body, value.publishedAt,
    value.updatedAt ?? null, value.draft ? 1 : 0, value.category, JSON.stringify(value.tags),
    cover ?? null, value.coverAlt ?? null, value.featured ? 1 : 0,
    value.series ?? null, value.canonicalUrl ?? null);
}

function updatePostStatement(
  database: D1Database | D1DatabaseSession,
  id: string,
  value: ReturnType<typeof postInputSchema.parse>,
  cover = value.cover,
): D1PreparedStatement {
  return database.prepare(
    `UPDATE posts SET slug = ?, title = ?, description = ?, body = ?, published_at = ?,
     updated_at = ?, draft = ?, category = ?, tags_json = ?, cover = ?, cover_alt = ?,
     featured = ?, series = ?, canonical_url = ? WHERE id = ?`,
  ).bind(value.slug, value.title, value.description, value.body, value.publishedAt,
    value.updatedAt ?? null, value.draft ? 1 : 0, value.category, JSON.stringify(value.tags),
    cover ?? null, value.coverAlt ?? null, value.featured ? 1 : 0,
    value.series ?? null, value.canonicalUrl ?? null, id);
}

async function savePost(
  database: D1Database,
  id: string,
  input: PostInput,
  create: boolean,
): Promise<AdminPost> {
  const value = postInputSchema.parse(input);
  if (!create) await getPost(database, id);
  const statement = create
    ? createPostStatement(database, id, value)
    : updatePostStatement(database, id, value);
  await statement.run();
  return getPost(database, id);
}

export function createPost(database: D1Database, input: PostInput): Promise<AdminPost> {
  return savePost(database, randomUUID(), input, true);
}

export function updatePost(database: D1Database, id: string, input: PostInput): Promise<AdminPost> {
  return savePost(database, id, input, false);
}

function managedCover(resolved: ResolvedPostAssetSync): string | undefined {
  if (!resolved.coverAssetId) return undefined;
  return resolved.assets.find(({ id }) => id === resolved.coverAssetId)?.url;
}

function isConstraintError(error: unknown): boolean {
  return error instanceof Error && /constraint failed|SQLITE_CONSTRAINT/i.test(error.message);
}

function isPostUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed: posts\./i.test(error.message);
}

async function savePostWithMedia(
  database: D1Database,
  id: string,
  input: PostInput,
  media: PostMediaInput,
  create: boolean,
): Promise<AdminPost> {
  const value = postInputSchema.parse(input);
  if (!create) await getPost(database, id);
  const resolved = await resolvePostAssetSync(database, {
    ...media,
    inlineKeys: extractManagedImageKeys(value.body),
  });
  const cover = resolved.coverAssetId ? managedCover(resolved) : value.cover;
  const postStatement = create
    ? createPostStatement(database, id, value, cover)
    : updatePostStatement(database, id, value, cover);
  try {
    await database.batch([
      postStatement,
      ...buildPostAssetSyncStatements(database, id, resolved, new Date()),
    ]);
  } catch (error) {
    if (!isConstraintError(error)) throw error;
    if (!create) {
      const current = await primary(database).prepare(
        "SELECT id FROM posts WHERE id = ?",
      ).bind(id).first<{ id: string }>();
      if (!current) throw new AdminNotFoundError("文章不存在。");
    }
    if (isPostUniqueConstraintError(error)) throw error;
    throw new AdminConflictError("图片状态或归属已变更，请重新保存。", {
      assetIds: resolved.libraryAssetIds,
    });
  }
  return getPost(database, id);
}

export function createPostWithMedia(
  database: D1Database,
  input: PostInput,
  media: PostMediaInput,
): Promise<AdminPost> {
  return savePostWithMedia(database, randomUUID(), input, media, true);
}

export function updatePostWithMedia(
  database: D1Database,
  id: string,
  input: PostInput,
  media: PostMediaInput,
): Promise<AdminPost> {
  return savePostWithMedia(database, id, input, media, false);
}

export async function deletePost(database: D1Database, id: string): Promise<void> {
  const result = await database.prepare("DELETE FROM posts WHERE id = ?").bind(id).run();
  if ((result.meta.changes ?? 0) === 0) throw new AdminNotFoundError("文章不存在。");
}

export async function listProjects(database: D1Database): Promise<AdminProject[]> {
  const { results } = await primary(database).prepare(
    "SELECT * FROM projects ORDER BY sort_order, project_date DESC",
  ).all<ProjectRow>();
  return results.map(projectFromRow);
}

export async function getProject(database: D1Database, id: string): Promise<AdminProject> {
  return projectFromRow(await firstRequired<ProjectRow>(
    primary(database).prepare("SELECT * FROM projects WHERE id = ?").bind(id),
    "项目不存在。",
  ));
}

async function saveProject(
  database: D1Database,
  id: string,
  input: ProjectInput,
  create: boolean,
): Promise<AdminProject> {
  const value = projectInputSchema.parse(input);
  const session = primary(database);
  const sortOrder = create
    ? await nextOrder(session, "projects")
    : (await getProject(database, id)).sortOrder;
  if (create) {
    await session.prepare(
      `INSERT INTO projects
       (id, slug, title, description, body, project_date, status, tags_json, cover,
        repository_url, demo_url, featured, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, value.slug, value.title, value.description, value.body, value.date, value.status,
      JSON.stringify(value.tags), value.cover ?? null, value.repositoryUrl ?? null,
      value.demoUrl ?? null, value.featured ? 1 : 0, sortOrder).run();
  } else {
    await session.prepare(
      `UPDATE projects SET slug = ?, title = ?, description = ?, body = ?, project_date = ?,
       status = ?, tags_json = ?, cover = ?, repository_url = ?, demo_url = ?, featured = ?
       WHERE id = ?`,
    ).bind(value.slug, value.title, value.description, value.body, value.date, value.status,
      JSON.stringify(value.tags), value.cover ?? null, value.repositoryUrl ?? null,
      value.demoUrl ?? null, value.featured ? 1 : 0, id).run();
  }
  return getProject(database, id);
}

export function createProject(database: D1Database, input: ProjectInput): Promise<AdminProject> {
  return saveProject(database, randomUUID(), input, true);
}

export function updateProject(
  database: D1Database,
  id: string,
  input: ProjectInput,
): Promise<AdminProject> {
  return saveProject(database, id, input, false);
}

export async function deleteProject(database: D1Database, id: string): Promise<void> {
  const result = await database.prepare("DELETE FROM projects WHERE id = ?").bind(id).run();
  if ((result.meta.changes ?? 0) === 0) throw new AdminNotFoundError("项目不存在。");
}

export async function getSetting(database: D1Database, key: SettingKey): Promise<unknown> {
  const statement = key === "friend_page"
    ? primary(database).prepare("SELECT value_json FROM friend_page WHERE id = 1")
    : primary(database).prepare("SELECT value_json FROM site_settings WHERE key = ?").bind(key);
  const row = await firstRequired<{ value_json: string }>(
    statement,
    key === "friend_page" ? "友链页设置不存在。" : "页面设置不存在。",
  );
  return JSON.parse(row.value_json);
}

export async function updateSetting(
  database: D1Database,
  key: SettingKey,
  value: unknown,
): Promise<unknown> {
  const parsed = settingSchemas[key].parse(value);
  const timestamp = new Date().toISOString();
  const statement = key === "friend_page"
    ? database.prepare("UPDATE friend_page SET value_json = ?, updated_at = ? WHERE id = 1")
      .bind(JSON.stringify(parsed), timestamp)
    : database.prepare("UPDATE site_settings SET value_json = ?, updated_at = ? WHERE key = ?")
      .bind(JSON.stringify(parsed), timestamp, key);
  await statement.run();
  return parsed;
}

export interface BlogBackupV1 {
  schemaVersion: 1;
  exportedAt: string;
  settings: Record<string, unknown>;
  categories: AdminCategory[];
  posts: AdminPost[];
  projects: AdminProject[];
  friends: AdminFriend[];
  friendPage: unknown;
  messages: AdminMessage[];
}

export interface BlogBackupV2 extends Omit<BlogBackupV1, "schemaVersion"> {
  schemaVersion: 2;
  mediaAssets: Array<{
    kvKey: string;
    originalName: string;
    contentType: string;
    sizeBytes?: number;
  }>;
  postAssetLinks: Array<{
    postId: string;
    kvKey: string;
    usage: "library" | "cover" | "inline";
    sortOrder: number;
  }>;
}

export interface BlogBackupV3 extends Omit<BlogBackupV2, "schemaVersion"> {
  schemaVersion: 3;
  musicTracks: AdminMusicTrack[];
}

export type BlogBackup = BlogBackupV1 | BlogBackupV2 | BlogBackupV3;

const backupKvKeySchema = z.string().min(1).refine((key) => {
  try {
    mediaUrlFromKey(key);
    return true;
  } catch {
    return false;
  }
}, "图片键不正确。");

const blogBackupV2MediaSchema = z.object({
  schemaVersion: z.literal(2),
  exportedAt: z.string().min(1),
  settings: z.record(z.string(), z.unknown()),
  categories: z.array(z.unknown()),
  posts: z.array(z.object({ id: z.string().min(1) }).passthrough()),
  projects: z.array(z.unknown()),
  friends: z.array(z.unknown()),
  friendPage: z.unknown().refine(
    (value) => value !== undefined && value !== null,
    "友链页设置不能为空。",
  ),
  messages: z.array(z.unknown()),
  mediaAssets: z.array(z.object({
    kvKey: backupKvKeySchema,
    originalName: z.string().min(1).max(240),
    contentType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative().optional(),
  }).strict()),
  postAssetLinks: z.array(z.object({
    postId: z.string().min(1),
    kvKey: backupKvKeySchema,
    usage: z.enum(["library", "cover", "inline"]),
    sortOrder: z.number().int().nonnegative(),
  }).strict()),
}).passthrough().superRefine((backup, context) => {
  const mediaKeys = new Set<string>();
  for (const [index, asset] of backup.mediaAssets.entries()) {
    if (mediaKeys.has(asset.kvKey)) {
      context.addIssue({
        code: "custom",
        path: ["mediaAssets", index, "kvKey"],
        message: "图片键重复。",
      });
    }
    mediaKeys.add(asset.kvKey);
  }
  const postIds = new Set(backup.posts.map(({ id }) => id));
  const links = new Set<string>();
  const coverPosts = new Set<string>();
  const usagesByPostAndKey = new Map<string, Set<"library" | "cover" | "inline">>();
  for (const [index, link] of backup.postAssetLinks.entries()) {
    if (!postIds.has(link.postId)) {
      context.addIssue({
        code: "custom",
        path: ["postAssetLinks", index, "postId"],
        message: "图片文章不存在。",
      });
    }
    if (!mediaKeys.has(link.kvKey)) {
      context.addIssue({
        code: "custom",
        path: ["postAssetLinks", index, "kvKey"],
        message: "图片清单中不存在该键。",
      });
    }
    const identity = `${link.postId}\0${link.kvKey}\0${link.usage}`;
    if (links.has(identity)) {
      context.addIssue({
        code: "custom",
        path: ["postAssetLinks", index],
        message: "图片链接重复。",
      });
    }
    links.add(identity);
    const usageKey = `${link.postId}\0${link.kvKey}`;
    const usages = usagesByPostAndKey.get(usageKey) ?? new Set();
    usages.add(link.usage);
    usagesByPostAndKey.set(usageKey, usages);
    if (link.usage === "cover") {
      if (coverPosts.has(link.postId)) {
        context.addIssue({
          code: "custom",
          path: ["postAssetLinks", index, "usage"],
          message: "同一文章只能恢复一个封面。",
        });
      }
      coverPosts.add(link.postId);
    }
  }
  for (const [index, rawPost] of backup.posts.entries()) {
    const post = rawPost as { id: string; cover?: unknown; body?: unknown };
    const coverKey = typeof post.cover === "string" ? mediaKeyFromUrl(post.cover) : undefined;
    const inlineKeys = typeof post.body === "string" ? extractManagedImageKeys(post.body) : [];
    const expectedInline = new Set(inlineKeys);
    const required = [
      ...(coverKey ? [{ key: coverKey, usage: "cover" as const }] : []),
      ...inlineKeys.map((key) => ({ key, usage: "inline" as const })),
    ];
    for (const { key, usage } of required) {
      const usages = usagesByPostAndKey.get(`${post.id}\0${key}`);
      if (!usages?.has(usage) || !usages.has("library")) {
        context.addIssue({
          code: "custom",
          path: ["posts", index, usage === "cover" ? "cover" : "body"],
          message: "文章中的托管图片缺少对应的图库和用途链接。",
        });
      }
    }
    for (const [linkIndex, link] of backup.postAssetLinks.entries()) {
      if (link.postId !== post.id || link.usage === "library") continue;
      const referenced = link.usage === "cover"
        ? coverKey === link.kvKey
        : expectedInline.has(link.kvKey);
      const usages = usagesByPostAndKey.get(`${link.postId}\0${link.kvKey}`);
      if (!referenced || !usages?.has("library")) {
        context.addIssue({
          code: "custom",
          path: ["postAssetLinks", linkIndex],
          message: "图片用途链接与文章正文或封面不一致。",
        });
      }
    }
  }
});

const blogBackupMusicTrackSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1),
  artist: z.string().min(1),
  neteaseSongId: z.string().regex(/^\d{1,20}$/),
  coverAssetId: z.uuid().optional(),
  coverUrl: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
  sortOrder: z.number().int().nonnegative(),
  enabled: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  embedUrl: z.url(),
  neteaseUrl: z.url(),
}).strict();

const blogBackupV3Schema = z.object({
  schemaVersion: z.literal(3),
  mediaAssets: z.array(z.object({
    kvKey: backupKvKeySchema,
    originalName: z.string().min(1).max(240),
    contentType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative().optional(),
  }).strict()),
  musicTracks: z.array(blogBackupMusicTrackSchema),
}).passthrough().superRefine((backup, context) => {
  const mediaKeys = new Set(backup.mediaAssets.map(({ kvKey }) => kvKey));
  const trackIds = new Set<string>();
  const songIds = new Set<string>();
  const sortOrders = new Set<number>();
  for (const [index, track] of backup.musicTracks.entries()) {
    if (trackIds.has(track.id)) {
      context.addIssue({
        code: "custom",
        path: ["musicTracks", index, "id"],
        message: "歌曲 ID 重复。",
      });
    }
    trackIds.add(track.id);
    if (songIds.has(track.neteaseSongId)) {
      context.addIssue({
        code: "custom",
        path: ["musicTracks", index, "neteaseSongId"],
        message: "网易云歌曲 ID 重复。",
      });
    }
    songIds.add(track.neteaseSongId);
    if (sortOrders.has(track.sortOrder)) {
      context.addIssue({
        code: "custom",
        path: ["musicTracks", index, "sortOrder"],
        message: "歌曲排序值重复。",
      });
    }
    sortOrders.add(track.sortOrder);
    if (track.embedUrl !== neteaseEmbedUrl(track.neteaseSongId)
      || track.neteaseUrl !== neteaseSongUrl(track.neteaseSongId)) {
      context.addIssue({
        code: "custom",
        path: ["musicTracks", index],
        message: "网易云歌曲链接与歌曲 ID 不一致。",
      });
    }
    if (Boolean(track.coverAssetId) !== Boolean(track.coverUrl)) {
      context.addIssue({
        code: "custom",
        path: ["musicTracks", index, "coverUrl"],
        message: "歌曲封面引用不完整。",
      });
      continue;
    }
    if (track.coverUrl) {
      let coverKey: string | undefined;
      try {
        coverKey = mediaKeyFromUrl(track.coverUrl);
      } catch {
        coverKey = undefined;
      }
      if (!coverKey || !mediaKeys.has(coverKey)) {
        context.addIssue({
          code: "custom",
          path: ["musicTracks", index, "coverUrl"],
          message: "歌曲封面不在图片清单中。",
        });
      }
    }
  }
});

export async function exportBlogData(database: D1Database): Promise<BlogBackup> {
  const [
    settingResult,
    categories,
    posts,
    projects,
    friends,
    friendPage,
    messages,
    musicTracks,
    mediaAssetResult,
    postAssetLinkResult,
  ] = await Promise.all([
    primary(database).prepare("SELECT key, value_json FROM site_settings ORDER BY key")
      .all<{ key: string; value_json: string }>(),
    listCategories(database),
    listPosts(database),
    listProjects(database),
    listFriends(database),
    getSetting(database, "friend_page"),
    listAdminMessages(database),
    listMusicTracks(database),
    primary(database).prepare(
      `SELECT DISTINCT asset.kv_key, asset.original_name, asset.content_type, asset.size_bytes
       FROM media_assets asset
       WHERE asset.state = 'ready' AND (
         EXISTS (SELECT 1 FROM post_asset_links link WHERE link.asset_id = asset.id)
         OR EXISTS (SELECT 1 FROM music_tracks track WHERE track.cover_asset_id = asset.id)
       )
       ORDER BY asset.kv_key`,
    ).all<{
      kv_key: string;
      original_name: string;
      content_type: string;
      size_bytes: number | null;
    }>(),
    primary(database).prepare(
      `SELECT link.post_id, asset.kv_key, link.usage, link.sort_order
       FROM post_asset_links link
       JOIN media_assets asset ON asset.id = link.asset_id
       WHERE asset.state = 'ready'
       ORDER BY link.post_id,
         CASE link.usage WHEN 'library' THEN 0 WHEN 'cover' THEN 1 ELSE 2 END,
         link.sort_order, asset.kv_key`,
    ).all<{
      post_id: string;
      kv_key: string;
      usage: "library" | "cover" | "inline";
      sort_order: number;
    }>(),
  ]);
  return {
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    settings: Object.fromEntries(
      settingResult.results.map(({ key, value_json }) => [key, JSON.parse(value_json)]),
    ),
    categories,
    posts,
    projects,
    friends,
    friendPage,
    messages,
    musicTracks,
    mediaAssets: mediaAssetResult.results.map((asset) => ({
      kvKey: asset.kv_key,
      originalName: asset.original_name,
      contentType: asset.content_type,
      ...(asset.size_bytes === null ? {} : { sizeBytes: Number(asset.size_bytes) }),
    })),
    postAssetLinks: postAssetLinkResult.results.map((link) => ({
      postId: link.post_id,
      kvKey: link.kv_key,
      usage: link.usage,
      sortOrder: Number(link.sort_order),
    })),
  };
}

const maxBackupStatements = 500;

export async function importBlogData(database: D1Database, backup: BlogBackup): Promise<void> {
  const schemaVersion = (backup as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== 3) {
    throw new Error("备份版本不受支持。");
  }
  const validatedV2 = schemaVersion === 2 ? blogBackupV2MediaSchema.parse(backup) : undefined;
  const validatedV3Base = schemaVersion === 3
    ? blogBackupV2MediaSchema.parse({ ...(backup as BlogBackupV3), schemaVersion: 2 })
    : undefined;
  const validatedV3Music = schemaVersion === 3 ? blogBackupV3Schema.parse(backup) : undefined;
  const validatedV3 = validatedV3Base && validatedV3Music ? {
    ...validatedV3Base,
    schemaVersion: 3 as const,
    musicTracks: validatedV3Music.musicTracks,
  } : undefined;
  const backupV2 = validatedV2 ? {
    ...(backup as BlogBackupV2),
    mediaAssets: validatedV2.mediaAssets,
    postAssetLinks: validatedV2.postAssetLinks,
  } : validatedV3 ? {
    ...(backup as BlogBackupV3),
    mediaAssets: validatedV3.mediaAssets,
    postAssetLinks: validatedV3.postAssetLinks,
    musicTracks: validatedV3.musicTracks,
  } : undefined;
  const settings = Object.entries(backup.settings).map(([key, value]) => {
    if (!(key in settingSchemas) || key === "friend_page") throw new Error(`未知设置：${key}`);
    return [key, settingSchemas[key as Exclude<SettingKey, "friend_page">].parse(value)] as const;
  });
  const friendPage = settingSchemas.friend_page.parse(backup.friendPage);
  const categories = backup.categories.map((value) => ({ ...value, ...categoryInputSchema.parse(value) }));
  const friends = backup.friends.map((value) => ({ ...value, ...friendInputSchema.parse(value) }));
  const posts = backup.posts.map((value) => ({ ...value, ...postInputSchema.parse(value) }));
  const projects = backup.projects.map((value) => ({ ...value, ...projectInputSchema.parse(value) }));
  const messages = backup.messages ?? [];
  const timestamp = new Date().toISOString();
  const mediaAssets = backupV2?.mediaAssets ?? [];
  const postAssetLinks = backupV2?.postAssetLinks ?? [];
  const musicTracks = validatedV3?.musicTracks ?? [];
  const importedAssetIds = new Map<string, string>();
  for (const asset of mediaAssets) {
    importedAssetIds.set(asset.kvKey, randomUUID());
  }
  const contentStatements: D1PreparedStatement[] = [
    database.prepare(
      `UPDATE post_media_backfill_state
       SET cursor_published_at = NULL, cursor_post_id = NULL, completed = ?, updated_at = ?
       WHERE id = 1`,
    ).bind(schemaVersion >= 2 ? 1 : 0, timestamp),
    database.prepare("DELETE FROM guestbook_messages"),
    database.prepare("DELETE FROM music_tracks"),
    database.prepare("DELETE FROM posts"),
    database.prepare("DELETE FROM projects"),
    database.prepare("DELETE FROM friends"),
    database.prepare("DELETE FROM categories"),
    database.prepare("DELETE FROM site_settings"),
    database.prepare("UPDATE friend_page SET value_json = ?, updated_at = ? WHERE id = 1")
      .bind(JSON.stringify(friendPage), timestamp),
    ...settings.map(([key, value]) => database.prepare(
      "INSERT INTO site_settings (key, value_json, updated_at) VALUES (?, ?, ?)",
    ).bind(key, JSON.stringify(value), timestamp)),
    ...categories.map((value) => database.prepare(
      "INSERT INTO categories (id, name, slug, description, sort_order, enabled) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(value.id, value.name, taxonomySlug(value.name), value.description ?? null,
      value.sortOrder, value.enabled ? 1 : 0)),
    ...friends.map((value) => database.prepare(
      `INSERT INTO friends (id, name, url, description, interests_json, sort_order, enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(value.id, value.name, value.url, value.description, JSON.stringify(value.interests),
      value.sortOrder, value.enabled ? 1 : 0, value.updatedAt ?? timestamp)),
    ...posts.map((value) => database.prepare(
      `INSERT INTO posts (id, slug, title, description, body, published_at, updated_at, draft,
       category, tags_json, cover, cover_alt, featured, series, canonical_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(value.id, value.slug, value.title, value.description, value.body, value.publishedAt,
      value.updatedAt ?? null, value.draft ? 1 : 0, value.category, JSON.stringify(value.tags),
      value.cover ?? null, value.coverAlt ?? null, value.featured ? 1 : 0,
      value.series ?? null, value.canonicalUrl ?? null)),
    ...projects.map((value) => database.prepare(
      `INSERT INTO projects (id, slug, title, description, body, project_date, status,
       tags_json, cover, repository_url, demo_url, featured, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(value.id, value.slug, value.title, value.description, value.body, value.date,
      value.status, JSON.stringify(value.tags), value.cover ?? null, value.repositoryUrl ?? null,
      value.demoUrl ?? null, value.featured ? 1 : 0, value.sortOrder)),
    ...messages.map((value) => database.prepare(
      `INSERT INTO guestbook_messages
       (id, name, email, website, content, status, ip_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    ).bind(value.id, value.name, value.email ?? null, value.website ?? null,
      value.content, value.status, value.createdAt, value.updatedAt)),
  ];
  const statements = [...contentStatements];
  if (backupV2) {
    const stagedAssets = mediaAssets.map((asset) => ({
      ...asset,
      id: importedAssetIds.get(asset.kvKey)!,
    }));
    const mediaJson = JSON.stringify(stagedAssets);
    const linkJson = JSON.stringify(postAssetLinks);
    const musicJson = JSON.stringify(musicTracks.map((track) => ({
      ...track,
      coverKvKey: track.coverUrl ? mediaKeyFromUrl(track.coverUrl) : null,
    })));
    const oldMarker = `backup_restore_${randomUUID()}`;
    const restoreGuard = `backup_guard_${randomUUID()}`;
    statements.unshift(
      database.prepare(
        `INSERT INTO media_operation_assertions (run_token, value)
         VALUES (?, (
           SELECT CASE WHEN NOT EXISTS (
             SELECT 1 FROM media_cleanup_jobs job
             WHERE job.claim_token IS NOT NULL
               AND job.kv_key IN (
                 SELECT json_extract(item.value, '$.kvKey') FROM json_each(?) item
               )
           ) THEN 1 END
         ))`,
      ).bind(restoreGuard, mediaJson),
      database.prepare(
        `UPDATE media_assets SET draft_token = ?
         WHERE NOT EXISTS (
           SELECT 1 FROM media_cleanup_jobs job
           WHERE job.asset_id = media_assets.id AND job.claim_token IS NOT NULL
         )`,
      ).bind(oldMarker),
    );
    statements.push(
      database.prepare(
        `INSERT INTO media_assets
         (id, kv_key, original_name, content_type, size_bytes, state, draft_token, created_at)
         SELECT
           json_extract(item.value, '$.id'),
           json_extract(item.value, '$.kvKey'),
           json_extract(item.value, '$.originalName'),
           json_extract(item.value, '$.contentType'),
           json_extract(item.value, '$.sizeBytes'),
           'ready', NULL, ?
         FROM json_each(?) item WHERE 1
         ON CONFLICT(kv_key) DO UPDATE SET
           original_name = excluded.original_name,
           content_type = excluded.content_type,
           size_bytes = excluded.size_bytes,
            state = 'ready',
            draft_token = NULL`,
      ).bind(timestamp, mediaJson),
      database.prepare(
         `DELETE FROM media_cleanup_jobs
         WHERE kv_key IN (
           SELECT json_extract(item.value, '$.kvKey') FROM json_each(?) item
         ) AND claim_token IS NULL`,
      ).bind(mediaJson),
      database.prepare(
        `INSERT INTO post_asset_links (post_id, asset_id, usage, sort_order, created_at)
         SELECT
           json_extract(item.value, '$.postId'),
           asset.id,
           json_extract(item.value, '$.usage'),
           json_extract(item.value, '$.sortOrder'),
           ?
         FROM json_each(?) item
         JOIN media_assets asset
           ON asset.kv_key = json_extract(item.value, '$.kvKey')
         WHERE asset.state = 'ready'`,
      ).bind(timestamp, linkJson),
      database.prepare(
        `INSERT INTO music_tracks
         (id, title, artist, netease_song_id, cover_asset_id, note, sort_order,
          enabled, created_at, updated_at)
         SELECT
           json_extract(item.value, '$.id'),
           json_extract(item.value, '$.title'),
           json_extract(item.value, '$.artist'),
           json_extract(item.value, '$.neteaseSongId'),
           asset.id,
           json_extract(item.value, '$.note'),
           json_extract(item.value, '$.sortOrder'),
           CASE json_extract(item.value, '$.enabled') WHEN 1 THEN 1 ELSE 0 END,
           json_extract(item.value, '$.createdAt'),
           json_extract(item.value, '$.updatedAt')
         FROM json_each(?) item
         LEFT JOIN media_assets asset
           ON asset.kv_key = json_extract(item.value, '$.coverKvKey')
          AND asset.state = 'ready'`,
      ).bind(musicJson),
      database.prepare(
        `UPDATE media_assets SET state = 'pending_delete'
         WHERE draft_token = ?
           AND NOT EXISTS (
             SELECT 1 FROM post_asset_links WHERE asset_id = media_assets.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM music_tracks WHERE cover_asset_id = media_assets.id
           )`,
      ).bind(oldMarker),
      database.prepare(
        `INSERT INTO media_cleanup_jobs
         (asset_id, kv_key, reason, queued_at, attempts, last_error)
         SELECT asset.id, asset.kv_key, 'backup_restore', ?, 0, NULL
         FROM media_assets asset
         WHERE asset.draft_token = ? AND asset.state = 'pending_delete'
           AND NOT EXISTS (
             SELECT 1 FROM post_asset_links WHERE asset_id = asset.id
           )
           AND NOT EXISTS (
             SELECT 1 FROM music_tracks WHERE cover_asset_id = asset.id
           )
         ON CONFLICT(asset_id) DO UPDATE SET
           kv_key = excluded.kv_key,
           reason = 'backup_restore',
           queued_at = excluded.queued_at,
           attempts = 0,
            last_error = NULL
         WHERE media_cleanup_jobs.claim_token IS NULL`,
      ).bind(timestamp, oldMarker),
      database.prepare(
        "UPDATE media_assets SET draft_token = NULL WHERE draft_token = ?",
      ).bind(oldMarker),
      database.prepare(
        "DELETE FROM media_operation_assertions WHERE run_token = ?",
      ).bind(restoreGuard),
    );
  }
  if (statements.length > maxBackupStatements) {
    throw new AdminConflictError(
      `备份包含 ${statements.length} 条数据操作，超过单次导入上限 ${maxBackupStatements}。请精简备份内容后重试。`,
    );
  }
  await database.batch(statements);
}

export async function getAdminOverview(database: D1Database) {
  const results = await database.batch<{ count: number }>([
    database.prepare("SELECT COUNT(*) AS count FROM posts"),
    database.prepare("SELECT COUNT(*) AS count FROM posts WHERE draft = 1"),
    database.prepare("SELECT COUNT(*) AS count FROM projects"),
    database.prepare("SELECT COUNT(*) AS count FROM categories"),
    database.prepare("SELECT COUNT(*) AS count FROM friends"),
    database.prepare("SELECT COUNT(*) AS count FROM guestbook_messages"),
    database.prepare("SELECT COUNT(*) AS count FROM guestbook_messages WHERE status = 'pending'"),
    database.prepare("SELECT COUNT(*) AS count FROM music_tracks"),
  ]);
  const count = (index: number) => Number(results[index]?.results[0]?.count ?? 0);
  return {
    posts: count(0),
    drafts: count(1),
    projects: count(2),
    categories: count(3),
    friends: count(4),
    messages: count(5),
    pendingMessages: count(6),
    musicTracks: count(7),
  };
}
