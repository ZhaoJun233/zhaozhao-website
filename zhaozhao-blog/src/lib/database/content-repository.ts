import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { getBlogDatabase } from "./connection";
import { initializeBlogDatabase } from "./schema";
import type { CategoryRow, FriendRow, PostRow, ProjectRow } from "./types";

function contentRoot(): string {
  return resolve(process.env.CONTENT_ROOT ?? join(process.cwd(), "src"));
}

export function getContentDatabase(): DatabaseSync {
  const database = getBlogDatabase();
  initializeBlogDatabase(database, contentRoot());
  return database;
}

export function readSetting<T>(key: string): T {
  const row = getContentDatabase().prepare(
    "SELECT value_json FROM site_settings WHERE key = ?",
  ).get(key) as { value_json?: string } | undefined;
  if (!row?.value_json) throw new Error(`Missing site setting: ${key}`);
  return JSON.parse(row.value_json) as T;
}

export function readFriendPage<T>(): T {
  const row = getContentDatabase().prepare(
    "SELECT value_json FROM friend_page WHERE id = 1",
  ).get() as { value_json?: string } | undefined;
  if (!row?.value_json) throw new Error("Missing friend page settings");
  return JSON.parse(row.value_json) as T;
}

export function readCategories(): CategoryRow[] {
  return getContentDatabase().prepare(
    "SELECT * FROM categories WHERE enabled = 1 ORDER BY sort_order, name",
  ).all() as unknown as CategoryRow[];
}

export function readFriends(): FriendRow[] {
  return getContentDatabase().prepare(
    "SELECT * FROM friends WHERE enabled = 1 ORDER BY sort_order, name",
  ).all() as unknown as FriendRow[];
}

export function readPosts(): PostRow[] {
  return getContentDatabase().prepare(
    "SELECT * FROM posts ORDER BY published_at DESC, slug",
  ).all() as unknown as PostRow[];
}

export function readProjects(): ProjectRow[] {
  return getContentDatabase().prepare(
    "SELECT * FROM projects ORDER BY sort_order, project_date DESC, slug",
  ).all() as unknown as ProjectRow[];
}
