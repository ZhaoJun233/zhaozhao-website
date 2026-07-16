import type { DatabaseSync } from "node:sqlite";
import { seedFromContentFiles } from "./seed";

const schema = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_digest TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL CHECK (json_valid(value_json)),
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
  );
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    body TEXT NOT NULL,
    published_at TEXT NOT NULL,
    updated_at TEXT,
    draft INTEGER NOT NULL DEFAULT 0 CHECK (draft IN (0, 1)),
    category TEXT NOT NULL,
    tags_json TEXT NOT NULL CHECK (json_valid(tags_json)),
    cover TEXT,
    cover_alt TEXT,
    featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
    series TEXT,
    canonical_url TEXT
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    body TEXT NOT NULL,
    project_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'archived')),
    tags_json TEXT NOT NULL CHECK (json_valid(tags_json)),
    cover TEXT,
    repository_url TEXT,
    demo_url TEXT,
    featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS friends (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    interests_json TEXT NOT NULL CHECK (json_valid(interests_json)),
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS friend_page (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    value_json TEXT NOT NULL CHECK (json_valid(value_json)),
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS guestbook_messages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    website TEXT,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'spam')),
    ip_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

const profileDetailsDefaults = {
  occupation: "",
  location: "",
  motto: "",
  email: "",
  website: "",
};

function migrateProfileDetails(database: DatabaseSync): void {
  const version = "profile-details-v1";
  if (database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(version)) return;
  const row = database.prepare("SELECT value_json FROM site_settings WHERE key = 'profile'")
    .get() as { value_json?: string } | undefined;
  if (!row?.value_json) return;

  database.exec("BEGIN IMMEDIATE");
  try {
    const profile = JSON.parse(row.value_json) as Record<string, unknown>;
    const migrated = { ...profile };
    for (const [key, value] of Object.entries(profileDetailsDefaults)) {
      if (typeof migrated[key] !== "string") migrated[key] = value;
    }
    database.prepare("UPDATE site_settings SET value_json = ?, updated_at = ? WHERE key = 'profile'")
      .run(JSON.stringify(migrated), new Date().toISOString());
    database.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(version, new Date().toISOString());
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function removeRetiredGiscusSetup(database: DatabaseSync): void {
  const version = "remove-giscus-setup-v1";
  if (database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(version)) return;
  const row = database.prepare("SELECT value_json FROM site_settings WHERE key = 'credits'")
    .get() as { value_json?: string } | undefined;
  if (!row?.value_json) return;

  database.exec("BEGIN IMMEDIATE");
  try {
    const credits = JSON.parse(row.value_json) as Record<string, unknown>;
    delete credits.discussionSetup;
    database.prepare("UPDATE site_settings SET value_json = ?, updated_at = ? WHERE key = 'credits'")
      .run(JSON.stringify(credits), new Date().toISOString());
    database.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(version, new Date().toISOString());
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function initializeBlogDatabase(database: DatabaseSync, contentRoot: string): void {
  database.exec(schema);
  if (!database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get("schema-v1")) {
    database.prepare(
      "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
    ).run("schema-v1", new Date().toISOString());
  }
  if (!database.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get("schema-v2-messages")) {
    database.prepare(
      "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
    ).run("schema-v2-messages", new Date().toISOString());
  }
  seedFromContentFiles(database, contentRoot);
  migrateProfileDetails(database);
  removeRetiredGiscusSetup(database);
}
