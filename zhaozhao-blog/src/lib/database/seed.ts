import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import matter from "gray-matter";
import { taxonomySlug } from "../slug";

const settingFiles = new Map([
  ["profile", "profile.json"],
  ["navigation", "navigation.json"],
  ["homepage", "homepage.json"],
  ["about", "about.json"],
  ["guestbook", "guestbook.json"],
  ["credits", "credits.json"],
  ["page_copy", "page-copy.json"],
  ["artwork", "artwork.json"],
]);

function readJson(contentRoot: string, filename: string) {
  return JSON.parse(readFileSync(join(contentRoot, "data", filename), "utf8"));
}

function dateText(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid content date: ${String(value)}`);
  return date.toISOString();
}

function nullableText(value: unknown): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function markdownFiles(directory: string) {
  return readdirSync(directory)
    .filter((filename) => extname(filename).toLowerCase() === ".md")
    .sort();
}

export function seedFromContentFiles(database: DatabaseSync, contentRoot: string): void {
  if (database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
    .get("initial-file-import-v1")) return;

  database.exec("BEGIN IMMEDIATE");
  try {
    const timestamp = new Date().toISOString();
    const insertSetting = database.prepare(
      "INSERT INTO site_settings (key, value_json, updated_at) VALUES (?, ?, ?)",
    );
    for (const [key, filename] of settingFiles) {
      insertSetting.run(key, JSON.stringify(readJson(contentRoot, filename)), timestamp);
    }

    const taxonomy = readJson(contentRoot, "taxonomy.json") as {
      categories: Array<{ name: string; description?: string }>;
    };
    const insertCategory = database.prepare(
      `INSERT INTO categories (id, name, slug, description, sort_order, enabled)
       VALUES (?, ?, ?, ?, ?, 1)`,
    );
    taxonomy.categories.forEach((category, index) => insertCategory.run(
      randomUUID(), category.name, taxonomySlug(category.name),
      nullableText(category.description), index,
    ));

    const friendSource = readJson(contentRoot, "friends.json") as {
      links: Array<{ name: string; url: string; description: string; interests: string[] }>;
      [key: string]: unknown;
    };
    const { links, ...friendPage } = friendSource;
    database.prepare(
      "INSERT INTO friend_page (id, value_json, updated_at) VALUES (1, ?, ?)",
    ).run(JSON.stringify(friendPage), timestamp);
    const insertFriend = database.prepare(
      `INSERT INTO friends
       (id, name, url, description, interests_json, sort_order, enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    );
    links.forEach((friend, index) => insertFriend.run(
      randomUUID(), friend.name, friend.url, friend.description,
      JSON.stringify(friend.interests), index, timestamp,
    ));

    const insertPost = database.prepare(
      `INSERT INTO posts
       (id, slug, title, description, body, published_at, updated_at, draft, category,
        tags_json, cover, cover_alt, featured, series, canonical_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const postsRoot = join(contentRoot, "content", "posts");
    for (const filename of markdownFiles(postsRoot)) {
      const parsed = matter(readFileSync(join(postsRoot, filename), "utf8"));
      insertPost.run(
        randomUUID(), basename(filename, extname(filename)), String(parsed.data.title),
        String(parsed.data.description), parsed.content, dateText(parsed.data.publishedAt),
        parsed.data.updatedAt ? dateText(parsed.data.updatedAt) : null,
        parsed.data.draft ? 1 : 0, String(parsed.data.category),
        JSON.stringify(parsed.data.tags ?? []), nullableText(parsed.data.cover),
        nullableText(parsed.data.coverAlt), parsed.data.featured ? 1 : 0,
        nullableText(parsed.data.series), nullableText(parsed.data.canonicalUrl),
      );
    }

    const insertProject = database.prepare(
      `INSERT INTO projects
       (id, slug, title, description, body, project_date, status, tags_json, cover,
        repository_url, demo_url, featured, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const projectsRoot = join(contentRoot, "content", "projects");
    markdownFiles(projectsRoot).forEach((filename, index) => {
      const parsed = matter(readFileSync(join(projectsRoot, filename), "utf8"));
      insertProject.run(
        randomUUID(), basename(filename, extname(filename)), String(parsed.data.title),
        String(parsed.data.description), parsed.content, dateText(parsed.data.date),
        String(parsed.data.status), JSON.stringify(parsed.data.tags ?? []),
        nullableText(parsed.data.cover), nullableText(parsed.data.repositoryUrl),
        nullableText(parsed.data.demoUrl), parsed.data.featured ? 1 : 0, index,
      );
    });

    database.prepare(
      "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
    ).run("initial-file-import-v1", timestamp);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
