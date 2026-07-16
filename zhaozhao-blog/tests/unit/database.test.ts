import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openBlogDatabase } from "../../src/lib/database/connection";
import { initializeBlogDatabase } from "../../src/lib/database/schema";

const temporaryDirectories: string[] = [];
const databases: ReturnType<typeof openBlogDatabase>[] = [];

function createDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "zhaozhao-database-"));
  temporaryDirectories.push(directory);
  const database = openBlogDatabase(join(directory, "blog.sqlite"));
  databases.push(database);
  return database;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("blog database initialization", () => {
  it("creates the complete schema and imports all current content", () => {
    const database = createDatabase();

    initializeBlogDatabase(database, resolve("src"));

    const tables = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all().map((row) => String(row.name));
    expect(tables).toEqual(expect.arrayContaining([
      "admin_sessions",
      "categories",
      "friend_page",
      "friends",
      "posts",
      "projects",
      "schema_migrations",
      "site_settings",
    ]));
    expect(database.prepare("SELECT COUNT(*) AS count FROM categories").get()?.count).toBe(3);
    expect(database.prepare("SELECT COUNT(*) AS count FROM friends").get()?.count).toBe(4);
    expect(database.prepare("SELECT COUNT(*) AS count FROM posts").get()?.count).toBe(6);
    expect(database.prepare("SELECT COUNT(*) AS count FROM projects").get()?.count).toBe(3);
    expect(database.prepare("SELECT COUNT(*) AS count FROM site_settings").get()?.count).toBe(8);
  });

  it("does not overwrite database edits when initialization runs again", () => {
    const database = createDatabase();
    initializeBlogDatabase(database, resolve("src"));
    database.prepare("UPDATE friends SET name = ? WHERE sort_order = 0").run("数据库里的友链");

    initializeBlogDatabase(database, resolve("src"));

    expect(database.prepare("SELECT name FROM friends WHERE sort_order = 0").get()?.name)
      .toBe("数据库里的友链");
    expect(database.prepare(
      "SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?",
    ).get("initial-file-import-v1")?.count).toBe(1);
  });
});
