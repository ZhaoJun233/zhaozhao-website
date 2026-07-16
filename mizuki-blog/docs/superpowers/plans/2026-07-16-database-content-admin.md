# Database-Backed Content Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Decap and file-backed runtime reads with one SQLite-backed, single-administrator content system for the entire Astro blog.

**Architecture:** A focused SQLite repository owns migrations, seed import, content reads, CRUD, ordering, sessions, and backups. Astro SSR uses that repository for public pages and APIs, while a same-origin `/admin/` workspace calls protected `/api/admin/*` endpoints. Existing JSON and Markdown files are one-time seed sources and remain readable backups.

**Tech Stack:** Astro 7 SSR, Node 24 `node:sqlite`, TypeScript, Zod, Marked, Vitest, Playwright, Docker Compose.

## Global Constraints

- Backend has one administrator.
- All maintainable content uses SQLite as the runtime source.
- Existing JSON and Markdown content imports without loss on first startup.
- Database file persists at `BLOG_DATABASE_PATH=/app/storage/blog.sqlite` through a Docker volume.
- `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET` come from environment variables.
- Admin saves become visible after a frontend refresh without rebuild or restart.
- Existing public route and API URLs remain compatible.
- `.codegraph/` remains untouched.

---

### Task 1: SQLite schema, migration, and seed import

**Files:**
- Create: `src/lib/database/connection.ts`
- Create: `src/lib/database/schema.ts`
- Create: `src/lib/database/seed.ts`
- Create: `src/lib/database/types.ts`
- Create: `tests/unit/database.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `openBlogDatabase(path?: string): DatabaseSync`
- Produces: `initializeBlogDatabase(database, contentRoot): void`
- Produces: typed row and input contracts for settings, posts, projects, categories, and friends.

- [ ] **Step 1: Write failing database tests**

Create tests that open a temporary database, call `initializeBlogDatabase`, and assert: all tables exist; current files seed 3 categories, 4 friends, posts, projects, and settings; a second initialization does not overwrite an edited friend.

- [ ] **Step 2: Verify the tests fail for missing modules**

Run: `npm test -- tests/unit/database.test.ts`

Expected: FAIL because `src/lib/database/connection.ts` and `schema.ts` do not exist.

- [ ] **Step 3: Implement the connection and versioned schema**

Use `DatabaseSync`, enable `foreign_keys`, `journal_mode=WAL`, and `busy_timeout=5000`, then create `schema_migrations`, `admin_sessions`, `site_settings`, `categories`, `posts`, `projects`, `friends`, and `friend_page` in one transaction.

- [ ] **Step 4: Implement transactional seed import**

Read current `src/data/*.json` and Markdown files, validate existing frontmatter, insert rows only when the seed marker is absent, and commit seed marker `initial-file-import-v1` only after all inserts succeed.

- [ ] **Step 5: Verify database tests pass**

Run: `npm test -- tests/unit/database.test.ts`

Expected: the new database test file passes.

### Task 2: Database repositories and runtime compatibility

**Files:**
- Create: `src/lib/database/content-repository.ts`
- Create: `src/lib/database/admin-repository.ts`
- Modify: `src/lib/runtime-content.ts`
- Modify: `tests/unit/runtime-content.test.ts`
- Modify: `tests/unit/data.test.ts`

**Interfaces:**
- Produces: `getRuntimeRepository(): RuntimeContentRepository`
- Produces repository methods `loadProfile`, `loadEditorial`, `loadPosts`, `loadProjects`.
- Produces admin CRUD methods for posts, projects, categories, friends, settings, ordering, export, and import.

- [ ] **Step 1: Change runtime tests to expect database reads**

Configure a temporary `BLOG_DATABASE_PATH`, initialize it, edit records through SQL, and assert `loadRuntimeEditorial()` and `loadRuntimePosts()` return database changes rather than later file changes.

- [ ] **Step 2: Verify the compatibility tests fail**

Run: `npm test -- tests/unit/runtime-content.test.ts tests/unit/data.test.ts`

Expected: FAIL because runtime loaders still read files.

- [ ] **Step 3: Implement focused repositories**

Map SQLite rows back to the current runtime shapes, parse JSON columns with Zod, render Markdown with the existing heading renderer, and exclude disabled categories/friends from public output.

- [ ] **Step 4: Point runtime loaders to SQLite**

Keep exported loader names unchanged so existing Astro pages require no broad rewrite.

- [ ] **Step 5: Verify repository and existing unit tests**

Run: `npm test -- tests/unit/database.test.ts tests/unit/runtime-content.test.ts tests/unit/data.test.ts`

Expected: all selected tests pass.

### Task 3: Single-admin authentication

**Files:**
- Create: `src/lib/admin/auth.ts`
- Create: `src/pages/api/admin/session.ts`
- Create: `src/pages/api/admin/session/status.ts`
- Create: `tests/unit/admin-auth.test.ts`

**Interfaces:**
- Produces: `createAdminSession(database): { token: string; expiresAt: Date }`
- Produces: `requireAdmin(request, database): AdminSession`
- Produces: login, logout, and session status endpoints.

- [ ] **Step 1: Write failing authentication tests**

Assert correct password creates a session, incorrect password is rejected, stored values are token digests, expired sessions fail, and logout deletes the session.

- [ ] **Step 2: Verify authentication tests fail**

Run: `npm test -- tests/unit/admin-auth.test.ts`

Expected: FAIL because the auth module does not exist.

- [ ] **Step 3: Implement password and session handling**

Use constant-time comparison, 32-byte random tokens, SHA-256 digests, seven-day expiry, HttpOnly `admin_session` cookies, SameSite Strict, and Secure when the request URL is HTTPS.

- [ ] **Step 4: Implement login, logout, and status routes**

Return 401 for invalid credentials, 429 after repeated failures in a short window, and `cache-control: no-store` on every response.

- [ ] **Step 5: Verify authentication tests pass**

Run: `npm test -- tests/unit/admin-auth.test.ts`

Expected: all authentication tests pass.

### Task 4: Protected management APIs

**Files:**
- Create: `src/lib/admin/http.ts`
- Create: `src/pages/api/admin/overview.ts`
- Create: `src/pages/api/admin/posts/index.ts`
- Create: `src/pages/api/admin/posts/[id].ts`
- Create: `src/pages/api/admin/projects/index.ts`
- Create: `src/pages/api/admin/projects/[id].ts`
- Create: `src/pages/api/admin/categories/index.ts`
- Create: `src/pages/api/admin/categories/[id].ts`
- Create: `src/pages/api/admin/friends/index.ts`
- Create: `src/pages/api/admin/friends/[id].ts`
- Create: `src/pages/api/admin/friends/order.ts`
- Create: `src/pages/api/admin/settings/[key].ts`
- Create: `src/pages/api/admin/export.ts`
- Create: `src/pages/api/admin/import.ts`
- Create: `tests/unit/admin-api.test.ts`

**Interfaces:**
- All routes return `{ data }` on success or `{ error, fieldErrors? }` on failure.
- Mutations require the authenticated admin session and same-origin JSON requests.

- [ ] **Step 1: Write failing route-handler tests**

Cover unauthorized writes, valid friend CRUD and ordering, category delete conflict, post draft update, setting validation, and export/import round-trip.

- [ ] **Step 2: Verify API tests fail**

Run: `npm test -- tests/unit/admin-api.test.ts`

Expected: FAIL because protected route modules are absent.

- [ ] **Step 3: Implement shared request helpers and validators**

Limit JSON bodies to 1 MiB, reject non-JSON writes, normalize URLs and tags, validate slugs, and map SQLite constraint errors to 409 responses.

- [ ] **Step 4: Implement CRUD, ordering, and settings endpoints**

Use repository transactions for every mutation and return the stored record after create or update.

- [ ] **Step 5: Implement atomic backup export and import**

Export `schemaVersion`, timestamp, settings, categories, posts, projects, friends, and friend page. Validate the entire import payload before replacing rows in one transaction.

- [ ] **Step 6: Verify API tests pass**

Run: `npm test -- tests/unit/admin-api.test.ts`

Expected: all API tests pass.

### Task 5: Unified admin workspace

**Files:**
- Create: `src/layouts/AdminLayout.astro`
- Create: `src/components/admin/AdminShell.astro`
- Create: `src/components/admin/RecordTable.astro`
- Create: `src/pages/admin/index.astro`
- Create: `src/pages/admin/login.astro`
- Create: `src/pages/admin/posts.astro`
- Create: `src/pages/admin/projects.astro`
- Create: `src/pages/admin/categories.astro`
- Create: `src/pages/admin/friends.astro`
- Create: `src/pages/admin/content.astro`
- Create: `src/pages/admin/data.astro`
- Create: `src/styles/admin.css`
- Create: `src/scripts/admin-session.ts`
- Create: `src/scripts/admin-records.ts`
- Create: `tests/e2e/admin.spec.ts`

**Interfaces:**
- Admin pages use `/api/admin/*` only; they never write files directly.
- `data-admin-resource`, `data-record-form`, and `data-record-table` attributes connect focused scripts to pages.

- [ ] **Step 1: Write failing admin browser tests**

Test login, overview counts, create/edit/delete friend, friend ordering, category editing, draft article editing, settings save, export, and logout.

- [ ] **Step 2: Verify browser tests fail**

Run: `npx playwright test tests/e2e/admin.spec.ts --project=desktop-1440`

Expected: FAIL because the custom admin routes do not exist.

- [ ] **Step 3: Implement the login and workspace shell**

Create a restrained editorial dashboard with a compact sidebar, clear active navigation, icon-labelled actions, visible save status, keyboard focus states, and responsive mobile navigation.

- [ ] **Step 4: Implement record list and editor workflows**

Use semantic dialogs/forms for create and edit, confirmation for deletion/import, up/down ordering buttons, server error rendering, and disabled submit states during requests.

- [ ] **Step 5: Implement structured page-content forms**

Render editable fields for profile, navigation, homepage, about, guestbook, credits, page copy, artwork, and friend-page copy; save each setting key independently.

- [ ] **Step 6: Verify desktop and mobile admin workflows**

Run: `npx playwright test tests/e2e/admin.spec.ts --project=desktop-1440 --project=mobile-390`

Expected: both projects pass without horizontal overflow.

### Task 6: Docker persistence and Decap removal

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `package.json`
- Modify: `package-lock.json`
- Delete: `public/admin/config.yml`
- Delete: `scripts/start-cms.mjs`
- Modify: `.env.example`
- Modify: `tests/unit/authoring.test.ts`

**Interfaces:**
- Compose exposes one `site` service and named volume `blog-data:/app/storage`.
- Runtime receives `BLOG_DATABASE_PATH`, `ADMIN_PASSWORD`, and `ADMIN_SESSION_SECRET`.

- [ ] **Step 1: Change infrastructure tests to the one-service database architecture**

Assert there is no `cms` service or Decap dependency, the storage volume is mounted read-write, and required environment variables exist.

- [ ] **Step 2: Verify infrastructure tests fail**

Run: `npm test -- tests/unit/authoring.test.ts`

Expected: FAIL against the existing Decap configuration.

- [ ] **Step 3: Update dependencies and container configuration**

Remove Decap packages and scripts, mount `blog-data`, keep source seed directories read-only, and configure local development database paths.

- [ ] **Step 4: Build and start the migrated container**

Run: `docker compose up -d --build --remove-orphans`

Expected: one healthy `site` service and a created SQLite database in the volume.

- [ ] **Step 5: Verify infrastructure tests pass**

Run: `docker run --rm -e CONTENT_ROOT=/app/src -e BLOG_DATABASE_PATH=/tmp/test.sqlite mizuki-blog-site npm run check`

Expected: Astro and TypeScript checks pass.

### Task 7: Maintenance documentation and final verification

**Files:**
- Modify: `docs/CONTENT-MAINTENANCE.md`
- Modify: `README.md`
- Modify: `tests/e2e/supporting-pages.spec.ts`

**Interfaces:**
- Documents exact login, backup, restore, password rotation, volume, and migration commands.

- [ ] **Step 1: Update maintenance and deployment documentation**

Document `/admin/`, required environment values, SQLite volume inspection, JSON export/import, container rebuild behavior, and recovery from a copied database file.

- [ ] **Step 2: Run all static and unit checks**

Run: `npm run check && npm test`

Expected: zero Astro/TypeScript diagnostics and every unit test passes.

- [ ] **Step 3: Run full browser regression**

Run: `npx playwright test`

Expected: public and admin suites pass at all configured viewport projects.

- [ ] **Step 4: Verify live dynamic synchronization**

Create a temporary friend and edit a category through the admin API, verify `/api/content`, `/friends/`, `/categories/`, and `/` update without rebuilding, then restore the exported backup.

- [ ] **Step 5: Verify persistence**

Restart the site container and confirm the restored content and administrator session behavior remain correct.

- [ ] **Step 6: Commit the completed migration**

Run:

```bash
git add mizuki-blog
git commit -m "feat: add database-backed content admin"
```

Expected: only `mizuki-blog` changes are committed; `.codegraph/` remains untracked.
