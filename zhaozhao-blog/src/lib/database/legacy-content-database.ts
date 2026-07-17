import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { getBlogDatabase } from "./connection";
import { initializeBlogDatabase } from "./schema";

function contentRoot(): string {
  return resolve(process.env.CONTENT_ROOT ?? join(process.cwd(), "src"));
}

export function getContentDatabase(): DatabaseSync {
  const database = getBlogDatabase();
  initializeBlogDatabase(database, contentRoot());
  return database;
}
