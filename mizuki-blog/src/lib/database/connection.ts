import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const cachedDatabases = new Map<string, DatabaseSync>();

export function resolveDatabasePath(path = process.env.BLOG_DATABASE_PATH): string {
  return path ? resolve(path) : resolve(process.cwd(), "storage", "blog.sqlite");
}

export function openBlogDatabase(path = resolveDatabasePath()): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const database = new DatabaseSync(path);
  database.exec("PRAGMA foreign_keys = ON");
  database.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") database.exec("PRAGMA journal_mode = WAL");
  return database;
}

export function getBlogDatabase(path = resolveDatabasePath()): DatabaseSync {
  const resolvedPath = path === ":memory:" ? path : resolve(path);
  const cached = cachedDatabases.get(resolvedPath);
  if (cached) return cached;
  const database = openBlogDatabase(resolvedPath);
  cachedDatabases.set(resolvedPath, database);
  return database;
}

export function closeBlogDatabase(path = resolveDatabasePath()): void {
  const resolvedPath = path === ":memory:" ? path : resolve(path);
  const database = cachedDatabases.get(resolvedPath);
  if (!database) return;
  database.close();
  cachedDatabases.delete(resolvedPath);
}
