import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeBlogDatabase, openBlogDatabase } from "../../src/lib/database/connection";
import { initializeBlogDatabase } from "../../src/lib/database/schema";
import {
  loadRuntimeEditorial,
  loadRuntimePosts,
  loadRuntimeProfile,
  loadRuntimeProjects,
} from "../../src/lib/runtime-content";

describe("runtime content repository", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "zhaozhao-runtime-"));
    process.env.BLOG_DATABASE_PATH = join(directory, "blog.sqlite");
    const database = openBlogDatabase(process.env.BLOG_DATABASE_PATH);
    initializeBlogDatabase(database, resolve("src"));
    database.close();
  });

  afterEach(() => {
    closeBlogDatabase(process.env.BLOG_DATABASE_PATH);
    delete process.env.BLOG_DATABASE_PATH;
    rmSync(directory, { recursive: true, force: true });
  });

  it("loads profile, categories, and friends from SQLite", async () => {
    const database = openBlogDatabase(process.env.BLOG_DATABASE_PATH);
    const storedProfile = JSON.parse(String(database.prepare(
      "SELECT value_json FROM site_settings WHERE key = 'profile'",
    ).get()?.value_json));
    storedProfile.name = "数据库里的233昭";
    database.prepare("UPDATE site_settings SET value_json = ? WHERE key = 'profile'")
      .run(JSON.stringify(storedProfile));
    database.prepare("UPDATE friends SET name = ? WHERE sort_order = 0").run("数据库友链");
    database.close();

    const [profile, editorial] = await Promise.all([
      loadRuntimeProfile(),
      loadRuntimeEditorial(),
    ]);

    expect(profile.name).toBe("数据库里的233昭");
    expect(profile.avatarUrl).toMatch(/^\/media\/profile\/.+\/$/);
    expect(editorial.taxonomy.categories.map(({ name }) => name)).toEqual([
      "开发",
      "阅读",
      "生活",
    ]);
    expect(editorial.friends.links).toHaveLength(4);
    expect(editorial.friends.links[0]?.name).toBe("数据库友链");
  });

  it("parses database posts and projects at request time", async () => {
    const [posts, projects] = await Promise.all([loadRuntimePosts(), loadRuntimeProjects()]);
    const post = posts.find(({ id }) => id === "astro-content-collections");

    expect(posts).toHaveLength(6);
    expect(projects).toHaveLength(3);
    expect(post?.data.publishedAt).toBeInstanceOf(Date);
    expect(post?.html).toContain("<h2 id=");
    expect(post?.headings.length).toBeGreaterThan(0);
  });
});
