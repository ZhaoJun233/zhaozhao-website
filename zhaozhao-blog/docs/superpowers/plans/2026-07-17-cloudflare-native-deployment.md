# Cloudflare Native Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the existing Astro Node/SQLite/Docker blog into a Cloudflare Worker using D1 for all runtime data and R2 for administrator-uploaded media, while preserving the current public and administrator functionality.

**Architecture:** Astro 7 runs through `@astrojs/cloudflare@14.1.3` in workerd. Repository functions become asynchronous and consume the `DB` D1 binding imported from `cloudflare:workers`; uploaded media uses the `MEDIA` R2 binding. Wrangler SQL migrations own schema creation, and the existing JSON backup/import workflow performs production data cutover.

**Tech Stack:** Astro 7.0.9, `@astrojs/cloudflare` 14.1.3, Wrangler 4.111.0, Cloudflare D1, Cloudflare R2, `@cloudflare/vitest-pool-workers` 0.18.5, Vitest 4.1.10, Playwright 1.61.1.

## Global Constraints

- Production runtime is Cloudflare Workers with compatibility date `2026-07-17` and `nodejs_compat`.
- D1 binding is `DB`, database name is `zhaozhao-blog`.
- R2 binding is `MEDIA`, bucket name is `zhaozhao-media`.
- `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` are Wrangler/Cloudflare secrets and are never committed.
- Existing public routes, administrator routes, page design, JSON backup format, and single-administrator behavior remain stable.
- Production does not retain `node:sqlite`, Docker, runtime filesystem seeding, or a dual SQLite/D1 abstraction.
- Existing built-in artwork is served as static Worker assets; only administrator uploads use R2.
- Every repository mutation uses prepared statements; multi-statement invariants use D1 `batch()`.
- The GitHub publication target is `ZhaoJun233/zhaozhao-website`, production branch `master`.

---

### Task 1: Cloudflare Runtime Scaffold

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `astro.config.mjs`
- Create: `wrangler.jsonc`
- Create: `.dev.vars.example`
- Create: `worker-configuration.d.ts`
- Modify: `.gitignore`
- Modify: `tests/unit/authoring.test.ts`
- Modify: `tests/unit/build-config.test.ts`

**Interfaces:**
- Produces: Worker bindings `DB: D1Database`, `MEDIA: R2Bucket`, `PUBLIC_SITE_URL`, optional Giscus variables, and generated Cloudflare types.
- Produces npm commands: `cf:typegen`, `db:migrate:local`, `db:migrate:remote`, `dev`, `preview`, and `deploy`.

- [ ] **Step 1: Write failing configuration tests**

Update the authoring/build tests to assert:

```ts
expect(packageJson.dependencies).toHaveProperty("@astrojs/cloudflare", "14.1.3");
expect(packageJson.dependencies).not.toHaveProperty("@astrojs/node");
expect(existsSync(resolve(appRoot, "wrangler.jsonc"))).toBe(true);
expect(existsSync(resolve(appRoot, "docker-compose.yml"))).toBe(false);
expect(existsSync(resolve(appRoot, "Dockerfile"))).toBe(false);
```

Parse `wrangler.jsonc` and assert the Worker name, compatibility date/flags, D1 binding `DB`, R2 binding `MEDIA`, and assets directory `./dist`.

- [ ] **Step 2: Run the tests and confirm the Node/Docker expectations fail**

Run:

```powershell
npx vitest run tests/unit/authoring.test.ts tests/unit/build-config.test.ts
```

Expected: failures because the Node adapter and Docker configuration still exist and Wrangler configuration does not.

- [ ] **Step 3: Install pinned Cloudflare dependencies**

Run:

```powershell
npm uninstall @astrojs/node
npm install @astrojs/cloudflare@14.1.3
npm install --save-dev wrangler@4.111.0 @cloudflare/vitest-pool-workers@0.18.5
```

- [ ] **Step 4: Configure Astro and Wrangler**

Use:

```js
import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";
import { resolveSiteUrl } from "./src/config/build.ts";

export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "compile", persistState: true }),
  site: resolveSiteUrl(process.env),
  trailingSlash: "always",
  devToolbar: { enabled: false },
});
```

Create `wrangler.jsonc` with `name: "zhaozhao-website"`, `main: "./dist/_worker.js/index.js"`, `compatibility_date: "2026-07-17"`, `compatibility_flags: ["nodejs_compat"]`, `assets.directory: "./dist"`, D1 binding `DB`, R2 binding `MEDIA`, and `vars.PUBLIC_SITE_URL`.

Add scripts:

```json
{
  "cf:typegen": "wrangler types",
  "db:migrate:local": "wrangler d1 migrations apply zhaozhao-blog --local",
  "db:migrate:remote": "wrangler d1 migrations apply zhaozhao-blog --remote",
  "dev": "wrangler types && astro dev",
  "preview": "wrangler types && astro preview",
  "deploy": "npm run build && wrangler deploy"
}
```

Document local secrets in `.dev.vars.example` and ignore `.dev.vars`, `.wrangler/`, and Wrangler persisted state.

- [ ] **Step 5: Generate binding types and run configuration tests**

Run:

```powershell
npm run cf:typegen
npx vitest run tests/unit/authoring.test.ts tests/unit/build-config.test.ts
```

Expected: configuration tests pass.

- [ ] **Step 6: Commit runtime scaffold**

```powershell
git add zhaozhao-blog/package.json zhaozhao-blog/package-lock.json zhaozhao-blog/astro.config.mjs zhaozhao-blog/wrangler.jsonc zhaozhao-blog/.dev.vars.example zhaozhao-blog/worker-configuration.d.ts zhaozhao-blog/.gitignore zhaozhao-blog/tests/unit/authoring.test.ts zhaozhao-blog/tests/unit/build-config.test.ts
git commit -m "build: configure Cloudflare Workers runtime"
```

### Task 2: D1 Schema and Deterministic Seed

**Files:**
- Create: `migrations/0001_schema.sql`
- Create: `migrations/0002_seed.sql`
- Create: `scripts/generate-d1-seed.mjs`
- Create: `tests/unit/d1-seed.test.ts`
- Remove: `src/lib/database/connection.ts`
- Remove: `src/lib/database/schema.ts`
- Remove: `src/lib/database/seed.ts`
- Modify: `package.json`

**Interfaces:**
- Produces D1 tables with the existing column names used by row types.
- Produces `npm run db:seed:generate`, which deterministically regenerates `migrations/0002_seed.sql` from repository fixtures.

- [ ] **Step 1: Write a failing deterministic seed test**

The test runs the generator twice and asserts byte-identical SQL containing the known settings, six post Slugs, three project Slugs, three categories, and four friend URLs.

```ts
expect(seed).toContain("astro-content-collections");
expect(seed).toContain("zhaozhao-blog");
expect(seed).toContain("spring-screen.example");
expect(secondSeed).toBe(seed);
```

- [ ] **Step 2: Run the seed test and confirm the generator is missing**

Run `npx vitest run tests/unit/d1-seed.test.ts` and expect a missing script/file failure.

- [ ] **Step 3: Create the D1 schema migration**

Port the current tables to `0001_schema.sql` with SQLite-compatible D1 SQL. Add indexes:

```sql
CREATE INDEX idx_posts_public ON posts(draft, published_at DESC);
CREATE INDEX idx_projects_order ON projects(sort_order, project_date DESC);
CREATE INDEX idx_friends_enabled_order ON friends(enabled, sort_order);
CREATE INDEX idx_messages_status_created ON guestbook_messages(status, created_at DESC);
CREATE INDEX idx_sessions_expiry ON admin_sessions(expires_at);
```

Do not create the application-owned `schema_migrations` table because Wrangler owns migration history.

- [ ] **Step 4: Implement the seed generator**

Read current JSON/Markdown fixtures with Node, parse frontmatter through `gray-matter`, escape SQL string literals by doubling single quotes, use stable IDs such as `seed-post-<slug>`, and write one transaction-safe migration containing `INSERT` statements.

Add:

```json
"db:seed:generate": "node scripts/generate-d1-seed.mjs"
```

- [ ] **Step 5: Generate SQL and apply migrations locally**

Run:

```powershell
npm run db:seed:generate
npm run db:migrate:local
npx vitest run tests/unit/d1-seed.test.ts
```

Expected: two migrations apply and the deterministic seed test passes.

- [ ] **Step 6: Remove SQLite runtime initialization and commit**

Remove the three Node SQLite runtime files after no production import references them.

```powershell
git add zhaozhao-blog/migrations zhaozhao-blog/scripts/generate-d1-seed.mjs zhaozhao-blog/tests/unit/d1-seed.test.ts zhaozhao-blog/package.json zhaozhao-blog/package-lock.json zhaozhao-blog/src/lib/database
git commit -m "feat: add D1 schema and content seed"
```

### Task 3: Asynchronous Public D1 Repository

**Files:**
- Create: `src/lib/cloudflare/bindings.ts`
- Rewrite: `src/lib/database/content-repository.ts`
- Modify: `src/lib/runtime-content.ts`
- Modify: all public pages, layouts, components, RSS/search/content APIs that consume runtime content
- Rewrite: `tests/unit/runtime-content.test.ts`
- Create: `tests/workers/content-repository.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Produces `getDatabase(): D1Database` and `getMediaBucket(): R2Bucket` from `cloudflare:workers` bindings.
- Produces async functions `readSetting<T>()`, `readFriendPage<T>()`, `readCategories()`, `readFriends()`, `readPosts()`, and `readProjects()`.

- [ ] **Step 1: Write failing Workers-pool repository tests**

Use `cloudflare:test`:

```ts
import { env } from "cloudflare:test";
const posts = await readPosts(env.DB);
expect(posts).toHaveLength(6);
expect((await readSetting(env.DB, "profile")).name).toBe("233昭");
```

Configure the Workers pool with the D1 migration directory and R2 binding.

- [ ] **Step 2: Run the Workers test and confirm the synchronous repository is incompatible**

Run `npx vitest run --project workers tests/workers/content-repository.test.ts` and expect import/type failures.

- [ ] **Step 3: Implement binding and async repository functions**

Use D1 statements:

```ts
export async function readPosts(database = getDatabase()): Promise<PostRow[]> {
  const result = await database.prepare(
    "SELECT * FROM posts ORDER BY published_at DESC, slug",
  ).all<PostRow>();
  return result.results;
}
```

Throw explicit missing-setting errors when `.first()` returns null.

- [ ] **Step 4: Make runtime content loaders await D1 reads**

Use `Promise.all()` for independent settings and lists, then preserve all existing Zod validation and Markdown rendering behavior.

- [ ] **Step 5: Update every public consumer**

Await runtime queries in Astro frontmatter and API routes. Public URLs and response formats stay unchanged.

- [ ] **Step 6: Run repository, runtime, RSS, SEO, and page tests**

```powershell
npx vitest run --project workers tests/workers/content-repository.test.ts
npx vitest run tests/unit/runtime-content.test.ts tests/unit/rss.test.ts tests/unit/seo.test.ts
npm run check
```

- [ ] **Step 7: Commit public D1 reads**

```powershell
git add zhaozhao-blog/src/lib/cloudflare zhaozhao-blog/src/lib/database/content-repository.ts zhaozhao-blog/src/lib/runtime-content.ts zhaozhao-blog/src/pages zhaozhao-blog/src/layouts zhaozhao-blog/src/components zhaozhao-blog/tests zhaozhao-blog/vitest.config.ts
git commit -m "refactor: read public content from D1"
```

### Task 4: D1 Authentication and Guestbook

**Files:**
- Rewrite: `src/lib/admin/auth.ts`
- Rewrite: `src/lib/admin/http.ts`
- Rewrite: `src/lib/database/message-repository.ts`
- Modify: `src/middleware.ts`
- Modify: session and message API routes
- Modify: `src/pages/guestbook.astro`
- Rewrite: `tests/unit/admin-auth.test.ts`
- Rewrite: `tests/unit/messages.test.ts`
- Create: `tests/workers/auth-messages.test.ts`

**Interfaces:**
- Async `createAdminSession(database)`, `authenticateAdminSession(database, token)`, and `deleteAdminSession(database, token)`.
- Async guestbook create/list/moderate/delete functions using D1.
- `handleAdminRequest()` authenticates against `getDatabase()` before executing an operation.

- [ ] **Step 1: Write failing D1 auth/message tests**

Cover session creation, token digest storage, expiry rejection, deletion, pending message creation, approved public listing, moderation, and deletion.

- [ ] **Step 2: Verify the current DatabaseSync signatures fail**

Run `npx vitest run --project workers tests/workers/auth-messages.test.ts`.

- [ ] **Step 3: Convert sessions to async D1 operations**

Generate tokens with `randomBytes`, store only the SHA-256 digest, delete expired sessions before creating a session, and query the row through a `first-primary` D1 session for read-after-write behavior.

- [ ] **Step 4: Convert guestbook operations**

Use prepared statements and preserve public/admin result types. Return inserted or updated rows by querying through the same D1 session.

- [ ] **Step 5: Update middleware and APIs**

Await session authentication in middleware and session status routes. Await guestbook list/create/moderation operations. Preserve cookies, same-origin checks, and JSON shapes.

- [ ] **Step 6: Run auth/message tests and commit**

```powershell
npx vitest run --project workers tests/workers/auth-messages.test.ts
npx vitest run tests/unit/admin-auth.test.ts tests/unit/messages.test.ts
npm run check
git add zhaozhao-blog/src zhaozhao-blog/tests
git commit -m "refactor: move sessions and guestbook to D1"
```

### Task 5: D1 Administrator CRUD and Backup

**Files:**
- Rewrite: `src/lib/database/admin-repository.ts`
- Modify: all `src/pages/admin/*.astro`
- Modify: all `src/pages/api/admin/**/*.ts`
- Rewrite: `tests/unit/admin-api.test.ts`
- Create: `tests/workers/admin-repository.test.ts`

**Interfaces:**
- Every list/get/create/update/delete/order/settings/overview/export/import function returns a Promise.
- Mutations use a `first-primary` session for immediate reads.
- Backup import validates all content before calling one D1 `batch()`.

- [ ] **Step 1: Write failing Workers-pool CRUD tests**

Cover category conflict protection, category rename propagation, disabled friend creation and ordering, Markdown-created post CRUD, project CRUD, setting updates, overview counts, and JSON backup round trip.

- [ ] **Step 2: Run the tests and confirm DatabaseSync code fails**

Run `npx vitest run --project workers tests/workers/admin-repository.test.ts`.

- [ ] **Step 3: Convert list/get/save/delete functions**

Use helpers:

```ts
async function firstRequired<T>(statement: D1PreparedStatement, message: string): Promise<T> {
  const row = await statement.first<T>();
  if (!row) throw new AdminNotFoundError(message);
  return row;
}
```

Use `database.batch()` for category rename plus post propagation and friend ordering.

- [ ] **Step 4: Convert settings, overview, and backup export/import**

Validate the full backup before constructing statements. Reject imports whose statement count exceeds the supported single-batch limit with a clear message directing the administrator to the documented Wrangler migration path. Execute the validated import in one D1 batch.

- [ ] **Step 5: Await repository calls in admin pages and APIs**

Astro page frontmatter awaits lists/overview. `handleAdminRequest` operations return awaited repository results. JSON route contracts stay unchanged.

- [ ] **Step 6: Run CRUD tests and administrator Playwright test**

```powershell
npx vitest run --project workers tests/workers/admin-repository.test.ts
npx vitest run tests/unit/admin-api.test.ts tests/unit/markdown-import.test.ts
npm run check
npx playwright test tests/e2e/admin.spec.ts --project=desktop-1440
```

- [ ] **Step 7: Commit administrator D1 operations**

```powershell
git add zhaozhao-blog/src/lib/database/admin-repository.ts zhaozhao-blog/src/pages/admin zhaozhao-blog/src/pages/api/admin zhaozhao-blog/tests
git commit -m "refactor: move administrator content workflows to D1"
```

### Task 6: Static Media and R2 Uploads

**Files:**
- Move: `src/assets/backgrounds/*` to `public/media/backgrounds/`
- Move: `src/assets/profile/*` to `public/media/profile/`
- Modify: `src/data/profile.json`
- Modify: `src/data/artwork.json`
- Modify: `src/lib/runtime-content.ts`
- Rewrite: `src/pages/media/[...path].ts`
- Create: `src/pages/api/admin/media.ts`
- Create: `src/lib/cloudflare/media.ts`
- Create: `tests/workers/media.test.ts`
- Modify: admin content UI/script to upload and insert the returned media path

**Interfaces:**
- `storeAdminMedia(bucket, file, now): Promise<{ key: string; url: string }>`.
- `/api/admin/media/` accepts authenticated multipart image uploads.
- `/media/uploads/<key>` reads an R2 object and returns metadata/cache headers.

- [ ] **Step 1: Write failing R2 tests**

Test allowed JPEG/PNG/WebP/GIF uploads, size rejection, unsupported MIME rejection, generated key format, object retrieval, ETag/content type, and 404 behavior.

- [ ] **Step 2: Verify tests fail without R2 media functions**

Run `npx vitest run --project workers tests/workers/media.test.ts`.

- [ ] **Step 3: Move built-in media to public assets**

Update seed paths to `/media/profile/...` and `/media/backgrounds/...`. Simplify `mediaUrl()` so existing `/media/` URLs pass through unchanged.

- [ ] **Step 4: Implement R2 upload/storage helpers**

Validate a 5 MiB maximum, use a UUID filename with a MIME-derived extension, store content type and original name as metadata, and return `/media/<key>`.

- [ ] **Step 5: Implement authenticated upload and public media routes**

The admin route uses `handleAdminRequest`. The public route only accesses keys beginning with `uploads/` and sets `cache-control: public, max-age=31536000, immutable`.

- [ ] **Step 6: Add administrator upload control and run tests**

Add a file input beside path fields on the profile/artwork editor. Upload through the API and place the returned URL into the active field without an additional page refresh.

Run Workers media tests, `npm run check`, and targeted Playwright tests.

- [ ] **Step 7: Commit media migration**

```powershell
git add zhaozhao-blog/public/media zhaozhao-blog/src zhaozhao-blog/tests
git commit -m "feat: store administrator media in R2"
```

### Task 7: Cloudflare-Native Test and Preview Pipeline

**Files:**
- Modify: `vitest.config.ts`
- Modify: `playwright.config.ts`
- Modify: unit tests still importing `node:sqlite`
- Create: `tests/workers/setup.ts`
- Modify: `package.json`
- Remove: obsolete SQLite test helpers and environment variables

**Interfaces:**
- Default `npm test` runs pure unit and Workers-pool integration tests.
- Playwright starts a workerd preview with isolated local D1/R2 state.

- [ ] **Step 1: Add a failing scan test for forbidden runtime dependencies**

Assert production files contain no `node:sqlite`, `BLOG_DATABASE_PATH`, `CONTENT_ROOT`, Docker volume path, or runtime `node:fs` imports.

- [ ] **Step 2: Configure Vitest projects**

Keep a Node project for pure utilities and add a Workers pool project with Wrangler configuration, D1 migrations, R2 binding, and isolated storage.

- [ ] **Step 3: Configure Playwright preview isolation**

Build once, apply local D1 migrations, start `astro preview` on port 4322 with `.dev.vars`, and keep mutation tests limited to desktop-1440. Ensure each full run starts from a copied local seed state rather than the live production database.

- [ ] **Step 4: Run the complete validation matrix**

```powershell
npm run cf:typegen
npm run check
npm test
npm run build
npm run test:e2e
```

Expected: no type errors, all unit/Workers tests pass, and all five viewport projects pass with only the four intentional admin skips.

- [ ] **Step 5: Commit test pipeline**

```powershell
git add zhaozhao-blog/package.json zhaozhao-blog/package-lock.json zhaozhao-blog/vitest.config.ts zhaozhao-blog/playwright.config.ts zhaozhao-blog/tests
git commit -m "test: run the blog against local Cloudflare bindings"
```

### Task 8: Deployment Documentation, Cleanup, and Publication

**Files:**
- Rewrite: `README.md`
- Rewrite: `AUTHORING.md`
- Rewrite: `docs/CONTENT-MAINTENANCE.md`
- Create: `docs/CLOUDFLARE-DEPLOYMENT.md`
- Remove: `Dockerfile`
- Remove: `docker-compose.yml`
- Remove: `.dockerignore`
- Modify: `.env.example` or replace it with `.dev.vars.example`
- Modify: Git remote configuration outside tracked files

**Interfaces:**
- Documents exact local, preview, D1/R2 creation, secret, migration, deployment, JSON import, domain cutover, backup, and rollback commands.

- [ ] **Step 1: Write documentation assertions**

Update authoring tests to require Cloudflare resource names, Wrangler commands, GitHub repository URL, JSON cutover sequence, and removal of Docker instructions.

- [ ] **Step 2: Rewrite operator documentation**

Document these commands exactly:

```powershell
npx wrangler d1 create zhaozhao-blog
npx wrangler r2 bucket create zhaozhao-media
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_SESSION_SECRET
npm run db:migrate:remote
npm run deploy
```

Explain that the generated D1 database ID must be copied into the `database_id` field returned by Wrangler before remote migration/deployment.

- [ ] **Step 3: Remove Docker and SQLite deployment files**

Delete Docker artifacts and obsolete environment documentation. Preserve the Docker version through Git history at commit `330d230`.

- [ ] **Step 4: Run final local verification**

Run the full validation matrix, `wrangler deploy --dry-run`, scan for forbidden Node/SQLite/Docker runtime references, and inspect Git status.

- [ ] **Step 5: Commit deployment documentation and cleanup**

```powershell
git add -A -- zhaozhao-blog
git commit -m "docs: finalize Cloudflare deployment workflow"
```

- [ ] **Step 6: Configure the GitHub publication remote**

After GitHub CLI authentication succeeds:

```powershell
git remote add origin https://github.com/ZhaoJun233/zhaozhao-website.git
git push -u origin master
```

If a different `origin` exists, name the new remote `zhaozhao` and push `master` there instead of replacing another user remote.

- [ ] **Step 7: Report Cloudflare dashboard actions**

Provide the Worker name, D1/R2 binding names, required secrets, GitHub build commands, remote deployment URL if created, data import checklist, and the exact remaining dashboard steps that require the user’s Cloudflare account session.
