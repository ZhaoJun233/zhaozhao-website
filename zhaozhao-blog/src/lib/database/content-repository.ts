import { getDatabase } from "../cloudflare/bindings";
import type { CategoryRow, FriendRow, PostRow, ProjectRow } from "./types";

export async function readSetting<T>(database: D1Database, key: string): Promise<T>;
export async function readSetting<T>(key: string): Promise<T>;
export async function readSetting<T>(
  databaseOrKey: D1Database | string,
  maybeKey?: string,
): Promise<T> {
  const database = typeof databaseOrKey === "string" ? getDatabase() : databaseOrKey;
  const key = typeof databaseOrKey === "string" ? databaseOrKey : maybeKey!;
  const row = await database.prepare(
    "SELECT value_json FROM site_settings WHERE key = ?",
  ).bind(key).first<{ value_json: string }>();
  if (!row) throw new Error(`Missing site setting: ${key}`);
  return JSON.parse(row.value_json) as T;
}

export async function readFriendPage<T>(database = getDatabase()): Promise<T> {
  const row = await database.prepare(
    "SELECT value_json FROM friend_page WHERE id = 1",
  ).first<{ value_json: string }>();
  if (!row) throw new Error("Missing friend page settings");
  return JSON.parse(row.value_json) as T;
}

export async function readCategories(database = getDatabase()): Promise<CategoryRow[]> {
  const result = await database.prepare(
    "SELECT * FROM categories WHERE enabled = 1 ORDER BY sort_order, name",
  ).all<CategoryRow>();
  return result.results;
}

export async function readFriends(database = getDatabase()): Promise<FriendRow[]> {
  const result = await database.prepare(
    "SELECT * FROM friends WHERE enabled = 1 ORDER BY sort_order, name",
  ).all<FriendRow>();
  return result.results;
}

export async function readPosts(database = getDatabase()): Promise<PostRow[]> {
  const result = await database.prepare(
    "SELECT * FROM posts ORDER BY published_at DESC, slug",
  ).all<PostRow>();
  return result.results;
}

export async function readProjects(database = getDatabase()): Promise<ProjectRow[]> {
  const result = await database.prepare(
    "SELECT * FROM projects ORDER BY sort_order, project_date DESC, slug",
  ).all<ProjectRow>();
  return result.results;
}
