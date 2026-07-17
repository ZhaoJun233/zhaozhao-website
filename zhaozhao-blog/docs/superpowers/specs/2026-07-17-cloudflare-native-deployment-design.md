# zhaozhao Website Cloudflare Native Deployment Design

## Objective

Migrate the existing Astro SSR personal blog from a Docker-hosted Node runtime with a local SQLite file to a fully Cloudflare-hosted application. The deployed site must retain the public blog, single-administrator backend, Markdown article import, projects, categories, friend links, guestbook moderation, editable page content, JSON backup/restore, RSS, search, and current visual design.

The target GitHub repository is `ZhaoJun233/zhaozhao-website`. Cloudflare Workers Builds will deploy the repository after it is connected in the Cloudflare dashboard.

## Chosen Architecture

The production application is a single Astro SSR Worker using `@astrojs/cloudflare`. The Worker serves dynamic pages and APIs while Cloudflare Static Assets serves compiled CSS, JavaScript, fonts, and the built-in artwork bundled with the repository.

Cloudflare D1 is the authoritative runtime content store. Cloudflare R2 stores administrator-uploaded media. The custom administrator session system remains database-backed so session revocation and expiry preserve their current behavior without adding a KV consistency dependency.

```text
Browser
  |
  v
Cloudflare Worker: Astro SSR, admin pages, APIs, RSS and search
  |--------------------|
  v                    v
D1 binding DB          R2 binding MEDIA
content + sessions     uploaded media
```

## Platform Configuration

The Worker name is `zhaozhao-website`. The D1 database name is `zhaozhao-blog` with binding `DB`. The R2 bucket name is `zhaozhao-media` with binding `MEDIA`.

`wrangler.jsonc` will contain:

- compatibility date `2026-07-17`;
- the `nodejs_compat` compatibility flag for supported `node:path`, `node:crypto`, and related APIs;
- the D1 `DB` binding;
- the R2 `MEDIA` binding;
- non-secret site configuration such as the public site URL;
- local persistence configuration through the Cloudflare adapter.

`ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` are Cloudflare secrets and never appear in Git. Optional Giscus values remain non-secret Worker variables.

The Astro adapter uses `@astrojs/cloudflare` with `output: "server"`. Built-in images use compile-time or passthrough processing rather than requiring a paid Cloudflare Images binding.

## Database Layer

The current synchronous `node:sqlite` repository API will be replaced with an asynchronous D1 repository API. Pages, layouts, middleware, and API handlers will await every content operation.

The repository boundary remains organized by responsibility:

- public content queries;
- administrator CRUD queries;
- visitor message submission and moderation;
- administrator authentication and sessions;
- backup export/import.

Prepared statements use D1 parameter binding. Multi-record writes, ordering changes, category renames, backup imports, and other atomic operations use `D1Database.batch()`. Database-specific result handling is isolated inside the repository layer so Astro pages do not depend on D1 result shapes.

Public requests read from the normal D1 binding. Operations that write and immediately read the updated row use a D1 session beginning with `first-primary` to guarantee read-after-write consistency.

## D1 Schema and Migrations

Wrangler migrations replace runtime `CREATE TABLE` and filesystem seeding. The migration directory contains ordered SQL files for:

1. the complete schema for settings, categories, posts, projects, friends, guestbook messages, and administrator sessions;
2. indexes for public post lists, session expiry, moderation queues, and ordered resources;
3. a deterministic development seed generated from the repository JSON and Markdown fixtures.

Production content is not overwritten by deployments. Migrations only alter schema and never re-import seed content after the initial database creation.

A Node build-time script reads the current `src/data` and `src/content` seed files and produces a local/preview seed SQL file. This script is not part of the Worker runtime and therefore may use filesystem APIs.

## Data Migration

The live SQLite database remains the source of truth until cutover.

The migration sequence is:

1. Export the complete JSON backup from the existing administrator backend.
2. Retain a copy of the SQLite database file as a rollback artifact.
3. Create the remote D1 database and R2 bucket through Wrangler.
4. Apply remote D1 migrations.
5. Deploy the Worker to its temporary `workers.dev` URL.
6. Configure administrator secrets.
7. Log in to the new backend and import the JSON backup.
8. Compare counts and representative records for posts, projects, categories, friends, messages, and all site settings.
9. Verify RSS, sitemap, search, media, Markdown rendering, and administrator mutations.
10. Connect the production domain only after verification.

During steps 1 through 10 the old backend is treated as read-only. If verification fails, DNS continues to point at the Docker deployment and the D1 database can be recreated from the saved JSON export.

## Media Storage

Repository-owned backgrounds, default avatars, and approved artwork move to `public/media` and are delivered as static Worker assets.

Runtime uploads use R2 keys under `uploads/<year>/<month>/<generated-name>`. An authenticated administrator API validates MIME type, extension, and size before writing an object. It returns a stable `/media/uploads/...` URL for profile, artwork, article cover, or Markdown references.

The public media route checks R2 only for the `uploads/` namespace. Responses include the stored content type, ETag, and long-lived cache headers. Missing keys return a normal 404 response. Markdown import parses the Markdown file only; referenced images must already use public or R2 URLs.

## Authentication and Security

The existing single-administrator model remains unchanged from the user’s perspective.

- Password verification uses `ADMIN_PASSWORD` from Cloudflare secrets.
- Session tokens remain random, hashed at rest, stored in D1, sent in an HttpOnly cookie, and expired by timestamp.
- Production cookies use `Secure`, `SameSite=Lax`, and the production hostname.
- State-changing administrator APIs retain same-origin validation.
- Visitor message throttling continues to hash request addresses with the secret and never stores raw addresses.
- R2 mutation endpoints are administrator-only.
- Backup import validates the complete payload before submitting an atomic D1 batch.

## Local Development

Local development runs in Cloudflare’s workerd-compatible environment with persistent local D1 and R2 state. Wrangler generates TypeScript binding types whenever `wrangler.jsonc` changes.

The primary commands are:

```text
npm run dev
npm run build
npm run preview
npm run cf:typegen
npm run db:migrate:local
npm run db:migrate:remote
npm run deploy
```

`.dev.vars.example` documents required secrets. `.dev.vars` and Wrangler local state are ignored by Git.

Docker, `node:sqlite`, the SQLite named volume, and the runtime filesystem seed path are removed from the Cloudflare deployment branch. The last Docker-compatible commit remains available in Git history for rollback.

## GitHub and Cloudflare Deployment

The local repository will add `https://github.com/ZhaoJun233/zhaozhao-website.git` as its publication remote after GitHub authentication is restored.

Cloudflare Workers Builds uses:

- production branch: `master`;
- install command: `npm ci`;
- build command: `npm run build`;
- deploy command: `npm run deploy`;
- secrets configured in Cloudflare rather than GitHub.

Pull requests and non-production branches may create preview Worker deployments after the production migration is stable.

## Error Handling

D1 constraint failures preserve the current human-readable duplicate-name and duplicate-Slug messages. Validation failures return structured field errors. D1 or R2 service errors return generic public messages while logging request identifiers for diagnosis.

The application must not silently fall back to seed data when D1 is unavailable. Health checks report separate application, D1, and R2 states so deployment failures are visible before domain cutover.

## Testing and Verification

Pure validation, Markdown parsing, date, slug, and serialization tests remain normal Vitest tests.

D1 repository integration tests run with the Cloudflare Vitest Workers pool and a migrated local D1 binding. R2 tests use a local bucket binding. Tests cover CRUD, atomic batches, session expiry, backup round trips, Markdown import, media upload, and migration idempotency.

Playwright runs against the Cloudflare local preview across the existing 320, 390, 768, 1440, and 1920 viewports. It verifies public pages, administrator login and mutations, guestbook moderation, RSS, sitemap, search, accessibility, detailed profile editing, Markdown import, and R2-backed media.

Before production cutover, the remote Worker receives smoke tests for health, homepage, administrator login, a temporary draft import and deletion, JSON export, and data counts.

## Non-Goals

- Multiple administrator accounts are not added.
- The visual design and navigation structure are not redesigned.
- Giscus is not enabled automatically.
- Existing local Markdown files do not become a second production content source.
- A separate frontend and API Worker are not introduced.
- SQLite/D1 dual-runtime support is not maintained after migration.

## Success Criteria

The migration is complete when the repository builds and previews under workerd, all automated tests pass against local D1/R2 bindings, the remote Worker contains the imported production content, administrator workflows operate without Docker, uploaded media is served from R2, and the production domain can move to Cloudflare without losing visible content or backend functionality.
