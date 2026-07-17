import { randomUUID } from "node:crypto";
import {
  categoryInputSchema,
  friendInputSchema,
  postInputSchema,
  projectInputSchema,
  settingSchemas,
  type CategoryInput,
  type FriendInput,
  type PostInput,
  type ProjectInput,
  type SettingKey,
} from "../admin/schemas";
import { taxonomySlug } from "../slug";
import type { CategoryRow, FriendRow, PostRow, ProjectRow } from "./types";
import { listAdminMessages, type AdminMessage } from "./message-repository";

export class AdminConflictError extends Error {
  constructor(message: string, public readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "AdminConflictError";
  }
}

export class AdminNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminNotFoundError";
  }
}

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

async function savePost(
  database: D1Database,
  id: string,
  input: PostInput,
  create: boolean,
): Promise<AdminPost> {
  const value = postInputSchema.parse(input);
  if (create) {
    await database.prepare(
      `INSERT INTO posts
       (id, slug, title, description, body, published_at, updated_at, draft, category,
        tags_json, cover, cover_alt, featured, series, canonical_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, value.slug, value.title, value.description, value.body, value.publishedAt,
      value.updatedAt ?? null, value.draft ? 1 : 0, value.category, JSON.stringify(value.tags),
      value.cover ?? null, value.coverAlt ?? null, value.featured ? 1 : 0,
      value.series ?? null, value.canonicalUrl ?? null).run();
  } else {
    await getPost(database, id);
    await database.prepare(
      `UPDATE posts SET slug = ?, title = ?, description = ?, body = ?, published_at = ?,
       updated_at = ?, draft = ?, category = ?, tags_json = ?, cover = ?, cover_alt = ?,
       featured = ?, series = ?, canonical_url = ? WHERE id = ?`,
    ).bind(value.slug, value.title, value.description, value.body, value.publishedAt,
      value.updatedAt ?? null, value.draft ? 1 : 0, value.category, JSON.stringify(value.tags),
      value.cover ?? null, value.coverAlt ?? null, value.featured ? 1 : 0,
      value.series ?? null, value.canonicalUrl ?? null, id).run();
  }
  return getPost(database, id);
}

export function createPost(database: D1Database, input: PostInput): Promise<AdminPost> {
  return savePost(database, randomUUID(), input, true);
}

export function updatePost(database: D1Database, id: string, input: PostInput): Promise<AdminPost> {
  return savePost(database, id, input, false);
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

export interface BlogBackup {
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

export async function exportBlogData(database: D1Database): Promise<BlogBackup> {
  const [settingResult, categories, posts, projects, friends, friendPage, messages] = await Promise.all([
    primary(database).prepare("SELECT key, value_json FROM site_settings ORDER BY key")
      .all<{ key: string; value_json: string }>(),
    listCategories(database),
    listPosts(database),
    listProjects(database),
    listFriends(database),
    getSetting(database, "friend_page"),
    listAdminMessages(database),
  ]);
  return {
    schemaVersion: 1,
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
  };
}

const maxBackupStatements = 500;

export async function importBlogData(database: D1Database, backup: BlogBackup): Promise<void> {
  if (backup.schemaVersion !== 1) throw new Error("备份版本不受支持。");
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
  const statements: D1PreparedStatement[] = [
    database.prepare("DELETE FROM guestbook_messages"),
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
  };
}
