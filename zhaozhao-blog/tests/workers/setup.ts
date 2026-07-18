import { beforeEach } from "vitest";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

beforeEach(async () => {
  await env.DB.exec(`
    DROP TABLE IF EXISTS d1_migrations;
    DROP TABLE IF EXISTS admin_sessions;
    DROP TABLE IF EXISTS guestbook_messages;
    DROP TABLE IF EXISTS music_tracks;
    DROP TABLE IF EXISTS media_cleanup_jobs;
    DROP TABLE IF EXISTS post_asset_links;
    DROP TABLE IF EXISTS media_operation_assertions;
    DROP TABLE IF EXISTS post_media_backfill_guards;
    DROP TABLE IF EXISTS post_media_backfill_state;
    DROP TABLE IF EXISTS media_assets;
    DROP TABLE IF EXISTS friend_page;
    DROP TABLE IF EXISTS friends;
    DROP TABLE IF EXISTS projects;
    DROP TABLE IF EXISTS posts;
    DROP TABLE IF EXISTS categories;
    DROP TABLE IF EXISTS site_settings;
  `);
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
