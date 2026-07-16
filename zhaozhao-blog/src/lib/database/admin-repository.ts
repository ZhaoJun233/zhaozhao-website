import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
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

function getRequired<T>(value: T | undefined, message: string): T {
  if (!value) throw new AdminNotFoundError(message);
  return value;
}

function nextOrder(database: DatabaseSync, table: "categories" | "friends" | "projects") {
  const row = database.prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM ${table}`)
    .get() as { value: number };
  return Number(row.value);
}

export function listCategories(database: DatabaseSync): AdminCategory[] {
  const rows = database.prepare("SELECT * FROM categories ORDER BY sort_order, name").all();
  return (rows as unknown as CategoryRow[]).map(categoryFromRow);
}

export function createCategory(database: DatabaseSync, input: CategoryInput): AdminCategory {
  const value = categoryInputSchema.parse(input);
  const id = randomUUID();
  database.prepare(
    `INSERT INTO categories (id, name, slug, description, sort_order, enabled)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, value.name, taxonomySlug(value.name), value.description ?? null,
    nextOrder(database, "categories"), value.enabled ? 1 : 0);
  return getCategory(database, id);
}

export function getCategory(database: DatabaseSync, id: string): AdminCategory {
  const row = database.prepare("SELECT * FROM categories WHERE id = ?").get(id) as
    unknown as CategoryRow | undefined;
  return categoryFromRow(getRequired(row, "分类不存在。"));
}

export function updateCategory(database: DatabaseSync, id: string, input: CategoryInput): AdminCategory {
  const current = getCategory(database, id);
  const value = categoryInputSchema.parse(input);
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(
      "UPDATE categories SET name = ?, slug = ?, description = ?, enabled = ? WHERE id = ?",
    ).run(value.name, taxonomySlug(value.name), value.description ?? null, value.enabled ? 1 : 0, id);
    if (current.name !== value.name) {
      database.prepare("UPDATE posts SET category = ? WHERE category = ?").run(value.name, current.name);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return getCategory(database, id);
}

export function deleteCategory(database: DatabaseSync, id: string): void {
  const category = getCategory(database, id);
  const references = database.prepare("SELECT COUNT(*) AS count FROM posts WHERE category = ?")
    .get(category.name) as { count: number };
  if (Number(references.count) > 0) {
    throw new AdminConflictError("该分类仍被文章使用。", { references: Number(references.count) });
  }
  database.prepare("DELETE FROM categories WHERE id = ?").run(id);
}

export function listFriends(database: DatabaseSync): AdminFriend[] {
  const rows = database.prepare("SELECT * FROM friends ORDER BY sort_order, name").all();
  return (rows as unknown as FriendRow[]).map(friendFromRow);
}

export function getFriend(database: DatabaseSync, id: string): AdminFriend {
  const row = database.prepare("SELECT * FROM friends WHERE id = ?").get(id) as
    unknown as FriendRow | undefined;
  return friendFromRow(getRequired(row, "友链不存在。"));
}

export function createFriend(database: DatabaseSync, input: FriendInput): AdminFriend {
  const value = friendInputSchema.parse(input);
  const id = randomUUID();
  database.prepare(
    `INSERT INTO friends
     (id, name, url, description, interests_json, sort_order, enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, value.name, value.url, value.description, JSON.stringify(value.interests),
    nextOrder(database, "friends"), value.enabled ? 1 : 0, new Date().toISOString());
  return getFriend(database, id);
}

export function updateFriend(database: DatabaseSync, id: string, input: FriendInput): AdminFriend {
  getFriend(database, id);
  const value = friendInputSchema.parse(input);
  database.prepare(
    `UPDATE friends SET name = ?, url = ?, description = ?, interests_json = ?,
     enabled = ?, updated_at = ? WHERE id = ?`,
  ).run(value.name, value.url, value.description, JSON.stringify(value.interests),
    value.enabled ? 1 : 0, new Date().toISOString(), id);
  return getFriend(database, id);
}

export function deleteFriend(database: DatabaseSync, id: string): void {
  if (database.prepare("DELETE FROM friends WHERE id = ?").run(id).changes === 0) {
    throw new AdminNotFoundError("友链不存在。");
  }
}

export function orderFriends(database: DatabaseSync, ids: string[]): AdminFriend[] {
  const current = listFriends(database).map(({ id }) => id).sort();
  if (ids.length !== current.length || [...ids].sort().some((id, index) => id !== current[index])) {
    throw new AdminConflictError("排序列表必须包含全部友链。" );
  }
  database.exec("BEGIN IMMEDIATE");
  try {
    const update = database.prepare("UPDATE friends SET sort_order = ? WHERE id = ?");
    ids.forEach((id, index) => update.run(index, id));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return listFriends(database);
}

export function listPosts(database: DatabaseSync): AdminPost[] {
  const rows = database.prepare("SELECT * FROM posts ORDER BY published_at DESC, slug").all();
  return (rows as unknown as PostRow[]).map(postFromRow);
}

export function getPost(database: DatabaseSync, id: string): AdminPost {
  const row = database.prepare("SELECT * FROM posts WHERE id = ?").get(id) as
    unknown as PostRow | undefined;
  return postFromRow(getRequired(row, "文章不存在。"));
}

function savePost(database: DatabaseSync, id: string, input: PostInput, create: boolean): AdminPost {
  const value = postInputSchema.parse(input);
  if (create) {
    database.prepare(
      `INSERT INTO posts
       (id, slug, title, description, body, published_at, updated_at, draft, category,
        tags_json, cover, cover_alt, featured, series, canonical_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, value.slug, value.title, value.description, value.body, value.publishedAt,
      value.updatedAt ?? null, value.draft ? 1 : 0, value.category, JSON.stringify(value.tags),
      value.cover ?? null, value.coverAlt ?? null, value.featured ? 1 : 0,
      value.series ?? null, value.canonicalUrl ?? null);
  } else {
    getPost(database, id);
    database.prepare(
      `UPDATE posts SET slug = ?, title = ?, description = ?, body = ?, published_at = ?,
       updated_at = ?, draft = ?, category = ?, tags_json = ?, cover = ?, cover_alt = ?,
       featured = ?, series = ?, canonical_url = ? WHERE id = ?`,
    ).run(value.slug, value.title, value.description, value.body, value.publishedAt,
      value.updatedAt ?? null, value.draft ? 1 : 0, value.category, JSON.stringify(value.tags),
      value.cover ?? null, value.coverAlt ?? null, value.featured ? 1 : 0,
      value.series ?? null, value.canonicalUrl ?? null, id);
  }
  return getPost(database, id);
}

export function createPost(database: DatabaseSync, input: PostInput): AdminPost {
  return savePost(database, randomUUID(), input, true);
}

export function updatePost(database: DatabaseSync, id: string, input: PostInput): AdminPost {
  return savePost(database, id, input, false);
}

export function deletePost(database: DatabaseSync, id: string): void {
  if (database.prepare("DELETE FROM posts WHERE id = ?").run(id).changes === 0) {
    throw new AdminNotFoundError("文章不存在。");
  }
}

export function listProjects(database: DatabaseSync): AdminProject[] {
  const rows = database.prepare("SELECT * FROM projects ORDER BY sort_order, project_date DESC").all();
  return (rows as unknown as ProjectRow[]).map(projectFromRow);
}

export function getProject(database: DatabaseSync, id: string): AdminProject {
  const row = database.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
    unknown as ProjectRow | undefined;
  return projectFromRow(getRequired(row, "项目不存在。"));
}

function saveProject(database: DatabaseSync, id: string, input: ProjectInput, create: boolean): AdminProject {
  const value = projectInputSchema.parse(input);
  const sortOrder = create ? nextOrder(database, "projects") : getProject(database, id).sortOrder;
  if (create) {
    database.prepare(
      `INSERT INTO projects
       (id, slug, title, description, body, project_date, status, tags_json, cover,
        repository_url, demo_url, featured, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, value.slug, value.title, value.description, value.body, value.date, value.status,
      JSON.stringify(value.tags), value.cover ?? null, value.repositoryUrl ?? null,
      value.demoUrl ?? null, value.featured ? 1 : 0, sortOrder);
  } else {
    database.prepare(
      `UPDATE projects SET slug = ?, title = ?, description = ?, body = ?, project_date = ?,
       status = ?, tags_json = ?, cover = ?, repository_url = ?, demo_url = ?, featured = ?
       WHERE id = ?`,
    ).run(value.slug, value.title, value.description, value.body, value.date, value.status,
      JSON.stringify(value.tags), value.cover ?? null, value.repositoryUrl ?? null,
      value.demoUrl ?? null, value.featured ? 1 : 0, id);
  }
  return getProject(database, id);
}

export function createProject(database: DatabaseSync, input: ProjectInput): AdminProject {
  return saveProject(database, randomUUID(), input, true);
}

export function updateProject(database: DatabaseSync, id: string, input: ProjectInput): AdminProject {
  return saveProject(database, id, input, false);
}

export function deleteProject(database: DatabaseSync, id: string): void {
  if (database.prepare("DELETE FROM projects WHERE id = ?").run(id).changes === 0) {
    throw new AdminNotFoundError("项目不存在。");
  }
}

export function getSetting(database: DatabaseSync, key: SettingKey): unknown {
  if (key === "friend_page") {
    const row = database.prepare("SELECT value_json FROM friend_page WHERE id = 1").get() as { value_json: string } | undefined;
    return JSON.parse(getRequired(row, "友链页设置不存在。").value_json);
  }
  const row = database.prepare("SELECT value_json FROM site_settings WHERE key = ?").get(key) as { value_json: string } | undefined;
  return JSON.parse(getRequired(row, "页面设置不存在。").value_json);
}

export function updateSetting(database: DatabaseSync, key: SettingKey, value: unknown): unknown {
  const parsed = settingSchemas[key].parse(value);
  const timestamp = new Date().toISOString();
  if (key === "friend_page") {
    database.prepare("UPDATE friend_page SET value_json = ?, updated_at = ? WHERE id = 1")
      .run(JSON.stringify(parsed), timestamp);
  } else {
    database.prepare("UPDATE site_settings SET value_json = ?, updated_at = ? WHERE key = ?")
      .run(JSON.stringify(parsed), timestamp, key);
  }
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

export function exportBlogData(database: DatabaseSync): BlogBackup {
  const settingRows = database.prepare("SELECT key, value_json FROM site_settings ORDER BY key").all();
  const settings = Object.fromEntries(
    (settingRows as unknown as Array<{ key: string; value_json: string }>)
      .map(({ key, value_json }) => [key, JSON.parse(value_json)]),
  );
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    settings,
    categories: listCategories(database),
    posts: listPosts(database),
    projects: listProjects(database),
    friends: listFriends(database),
    friendPage: getSetting(database, "friend_page"),
    messages: listAdminMessages(database),
  };
}

export function importBlogData(database: DatabaseSync, backup: BlogBackup): void {
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

  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec("DELETE FROM guestbook_messages; DELETE FROM posts; DELETE FROM projects; DELETE FROM friends; DELETE FROM categories; DELETE FROM site_settings;");
    const timestamp = new Date().toISOString();
    const insertSetting = database.prepare(
      "INSERT INTO site_settings (key, value_json, updated_at) VALUES (?, ?, ?)",
    );
    settings.forEach(([key, value]) => insertSetting.run(key, JSON.stringify(value), timestamp));
    database.prepare("UPDATE friend_page SET value_json = ?, updated_at = ? WHERE id = 1")
      .run(JSON.stringify(friendPage), timestamp);

    const insertCategory = database.prepare(
      "INSERT INTO categories (id, name, slug, description, sort_order, enabled) VALUES (?, ?, ?, ?, ?, ?)",
    );
    categories.forEach((value) => insertCategory.run(value.id, value.name, taxonomySlug(value.name),
      value.description ?? null, value.sortOrder, value.enabled ? 1 : 0));
    const insertFriend = database.prepare(
      `INSERT INTO friends (id, name, url, description, interests_json, sort_order, enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    friends.forEach((value) => insertFriend.run(value.id, value.name, value.url, value.description,
      JSON.stringify(value.interests), value.sortOrder, value.enabled ? 1 : 0, value.updatedAt ?? timestamp));
    const insertPost = database.prepare(
      `INSERT INTO posts (id, slug, title, description, body, published_at, updated_at, draft,
       category, tags_json, cover, cover_alt, featured, series, canonical_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    posts.forEach((value) => insertPost.run(value.id, value.slug, value.title, value.description,
      value.body, value.publishedAt, value.updatedAt ?? null, value.draft ? 1 : 0, value.category,
      JSON.stringify(value.tags), value.cover ?? null, value.coverAlt ?? null,
      value.featured ? 1 : 0, value.series ?? null, value.canonicalUrl ?? null));
    const insertProject = database.prepare(
      `INSERT INTO projects (id, slug, title, description, body, project_date, status,
       tags_json, cover, repository_url, demo_url, featured, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    projects.forEach((value) => insertProject.run(value.id, value.slug, value.title,
      value.description, value.body, value.date, value.status, JSON.stringify(value.tags),
      value.cover ?? null, value.repositoryUrl ?? null, value.demoUrl ?? null,
      value.featured ? 1 : 0, value.sortOrder));
    const insertMessage = database.prepare(
      `INSERT INTO guestbook_messages
       (id, name, email, website, content, status, ip_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    );
    messages.forEach((value) => insertMessage.run(value.id, value.name, value.email ?? null,
      value.website ?? null, value.content, value.status, value.createdAt, value.updatedAt));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function getAdminOverview(database: DatabaseSync) {
  return {
    posts: Number((database.prepare("SELECT COUNT(*) AS count FROM posts").get() as { count: number }).count),
    drafts: Number((database.prepare("SELECT COUNT(*) AS count FROM posts WHERE draft = 1").get() as { count: number }).count),
    projects: Number((database.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number }).count),
    categories: Number((database.prepare("SELECT COUNT(*) AS count FROM categories").get() as { count: number }).count),
    friends: Number((database.prepare("SELECT COUNT(*) AS count FROM friends").get() as { count: number }).count),
    messages: Number((database.prepare("SELECT COUNT(*) AS count FROM guestbook_messages").get() as { count: number }).count),
    pendingMessages: Number((database.prepare("SELECT COUNT(*) AS count FROM guestbook_messages WHERE status = 'pending'").get() as { count: number }).count),
  };
}
