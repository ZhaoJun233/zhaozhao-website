# Article Image Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the single administrator upload article covers and inline images, manage each article's image list, safely retain shared images, and delete only unreferenced Workers KV objects when an article is removed.

**Architecture:** D1 becomes the source of truth for managed article image metadata, article-to-image links, and retryable cleanup jobs, while Workers KV continues storing image bytes. Article-specific upload and repository services keep the existing page-setting media endpoint unchanged; post save operations rebuild links atomically, and delete operations use in-transaction `NOT EXISTS` checks before scheduling KV cleanup.

**Tech Stack:** Astro 7 SSR, TypeScript 6, Cloudflare Workers, D1, Workers KV, Zod, Vitest, `@cloudflare/vitest-pool-workers`, Playwright.

## Global Constraints

- Support JPEG, PNG, WebP, and GIF only; reject SVG and every non-image type.
- Keep the existing 5 MiB per-image limit.
- Keep `/api/admin/media/` working for profile and page-setting images.
- Use `/api/admin/post-assets/` for article images.
- Keep `posts.cover` as the public/runtime cover URL; `coverAssetId` is request metadata, not a replacement runtime column.
- Every managed article image has a `library` link; `cover` and `inline` are additional usages.
- A shared image is physically deleted only after no article links remain.
- D1 commits article deletion before best-effort KV cleanup; cleanup failures remain retryable.
- Preserve all existing `/media/uploads/...` URLs.
- JSON backups contain asset metadata and links, not KV image bytes.
- Use TDD for every behavior change and run the exact failing test before production code.

---

## File Structure

### New files

- `migrations/0004_post_media.sql` — D1 asset, link, and cleanup-job tables.
- `src/lib/admin/post-images.ts` — managed image URL extraction and normalization.
- `src/lib/database/media-repository.ts` — D1-only media metadata, link, preview, deletion, and cleanup-job operations.
- `src/lib/cloudflare/post-media.ts` — KV upload/delete orchestration around the D1 repository.
- `src/pages/api/admin/post-assets/index.ts` — article image upload endpoint.
- `src/pages/api/admin/post-assets/drafts/[token].ts` — temporary upload cancellation endpoint.
- `src/pages/api/admin/post-assets/backfill.ts` — idempotent legacy article-image backfill endpoint.
- `src/pages/api/admin/posts/[id]/assets/index.ts` — article image list endpoint.
- `src/pages/api/admin/posts/[id]/assets/[assetId].ts` — remove-from-article endpoint.
- `src/pages/api/admin/posts/[id]/delete-preview.ts` — exclusive/shared delete preview.
- `src/scripts/admin-post-editor.ts` — article-only CRUD, slug, form state, and delete dialog.
- `src/scripts/admin-post-media.ts` — upload, cover, inline insertion, gallery, and draft cleanup UI.
- `tests/unit/post-images.test.ts` — managed URL parser tests.
- `tests/workers/media-repository.test.ts` — asset/link/delete lifecycle tests.

### Modified files

- `src/lib/database/types.ts` — media row interfaces.
- `src/lib/admin/schemas.ts` — post media metadata request schema.
- `src/lib/database/admin-repository.ts` — media-aware post save, delete, backup, and restore.
- `src/lib/cloudflare/media.ts` — reusable image validation/key helpers and richer KV metadata.
- `src/pages/api/admin/posts/index.ts` — media-aware create.
- `src/pages/api/admin/posts/[id].ts` — media-aware update/delete.
- `src/pages/api/admin/posts/import.ts` — parse-to-preview instead of immediate creation.
- `src/pages/admin/posts.astro` — article editor and image manager markup.
- `src/scripts/admin-post-import.ts` — import result into form.
- `src/layouts/AdminLayout.astro` — load article-specific scripts.
- `src/styles/admin.css` — responsive editor/media UI.
- `cloudflare-runtime.d.ts` — KV metadata and delete signatures used by new services.
- `tests/workers/admin-repository.test.ts` — post save/delete/backup integration.
- `tests/workers/media.test.ts` — article image upload metadata.
- `tests/unit/markdown-import.test.ts` — preview import behavior.
- `tests/unit/authoring.test.ts` — new files and binding invariants.
- `tests/e2e/admin.spec.ts` — complete image authoring workflow.
- `docs/CONTENT-MAINTENANCE.md` and `AUTHORING.md` — administrator instructions and backup limitations.

---

### Task 1: Add the D1 media schema and runtime row types

**Files:**
- Create: `zhaozhao-blog/migrations/0004_post_media.sql`
- Modify: `zhaozhao-blog/src/lib/database/types.ts`
- Modify: `zhaozhao-blog/tests/unit/authoring.test.ts`
- Test: `zhaozhao-blog/tests/workers/media-repository.test.ts`

**Interfaces:**
- Produces: `MediaAssetRow`, `PostAssetLinkRow`, `MediaCleanupJobRow`.
- Produces D1 tables: `media_assets`, `post_asset_links`, `media_cleanup_jobs`.

- [ ] **Step 1: Write the failing schema test**

Create `tests/workers/media-repository.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

describe("article media schema", () => {
  it("creates media assets, post links, and cleanup jobs", async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const names = tables.results.map(({ name }) => name);

    expect(names).toContain("media_assets");
    expect(names).toContain("post_asset_links");
    expect(names).toContain("media_cleanup_jobs");
  });
});
```

- [ ] **Step 2: Run the Workers test and verify RED**

Run:

```powershell
npx vitest run --config vitest.workers.config.ts tests/workers/media-repository.test.ts
```

Expected: FAIL because the three tables do not exist.

- [ ] **Step 3: Add the migration**

Create `migrations/0004_post_media.sql` with the exact schema from the approved design:

```sql
CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  kv_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER,
  state TEXT NOT NULL DEFAULT 'uploading'
    CHECK (state IN ('uploading', 'ready', 'pending_delete')),
  draft_token TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_media_assets_draft ON media_assets(draft_token, created_at);

CREATE TABLE post_asset_links (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  usage TEXT NOT NULL CHECK (usage IN ('library', 'cover', 'inline')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, asset_id, usage)
);

CREATE INDEX idx_post_asset_links_asset ON post_asset_links(asset_id);
CREATE UNIQUE INDEX idx_post_asset_one_cover
  ON post_asset_links(post_id) WHERE usage = 'cover';

CREATE TABLE media_cleanup_jobs (
  asset_id TEXT PRIMARY KEY REFERENCES media_assets(id) ON DELETE CASCADE,
  kv_key TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL CHECK (reason IN (
    'article_delete', 'manual_remove', 'draft_cancelled', 'draft_expired',
    'upload_failed', 'backup_restore'
  )),
  queued_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
```

- [ ] **Step 4: Add exact row interfaces**

Append to `src/lib/database/types.ts`:

```ts
export type MediaAssetState = "uploading" | "ready" | "pending_delete";
export type PostAssetUsage = "library" | "cover" | "inline";

export interface MediaAssetRow {
  id: string;
  kv_key: string;
  original_name: string;
  content_type: string;
  size_bytes: number | null;
  state: MediaAssetState;
  draft_token: string | null;
  created_at: string;
}

export interface PostAssetLinkRow {
  post_id: string;
  asset_id: string;
  usage: PostAssetUsage;
  sort_order: number;
  created_at: string;
}

export interface MediaCleanupJobRow {
  asset_id: string;
  kv_key: string;
  reason: "article_delete" | "manual_remove" | "draft_cancelled" |
    "draft_expired" | "upload_failed" | "backup_restore";
  queued_at: string;
  attempts: number;
  last_error: string | null;
}
```

- [ ] **Step 5: Extend the authoring invariant test**

In `tests/unit/authoring.test.ts`, add:

```ts
const mediaMigration = readFileSync(
  resolve(appRoot, "migrations/0004_post_media.sql"),
  "utf8",
);
for (const table of ["media_assets", "post_asset_links", "media_cleanup_jobs"]) {
  expect(mediaMigration).toContain(`CREATE TABLE ${table}`);
}
expect(mediaMigration).toContain("ON DELETE CASCADE");
expect(mediaMigration).toContain("CREATE UNIQUE INDEX idx_post_asset_one_cover");
expect(mediaMigration).toContain("WHERE usage = 'cover'");
```

- [ ] **Step 6: Run focused tests and verify GREEN**

```powershell
npx vitest run tests/unit/authoring.test.ts
npx vitest run --config vitest.workers.config.ts tests/workers/media-repository.test.ts
```

Expected: both test files PASS.

- [ ] **Step 7: Commit**

```powershell
git add migrations/0004_post_media.sql src/lib/database/types.ts tests/unit/authoring.test.ts tests/workers/media-repository.test.ts
git commit -m "feat: add article media schema"
```

---

### Task 2: Parse and normalize managed article image URLs

**Files:**
- Create: `zhaozhao-blog/src/lib/admin/post-images.ts`
- Create: `zhaozhao-blog/tests/unit/post-images.test.ts`

**Interfaces:**
- Produces: `mediaUrlFromKey(key: string): string`.
- Produces: `mediaKeyFromUrl(value: string): string | undefined`.
- Produces: `extractManagedImageKeys(markdown: string): string[]`.

- [ ] **Step 1: Write failing parser tests**

```ts
import { describe, expect, it } from "vitest";
import {
  extractManagedImageKeys,
  mediaKeyFromUrl,
  mediaUrlFromKey,
} from "../../src/lib/admin/post-images";

describe("managed article images", () => {
  it("normalizes only uploads keys", () => {
    expect(mediaUrlFromKey("uploads/2026/07/a.webp"))
      .toBe("/media/uploads/2026/07/a.webp");
    expect(mediaKeyFromUrl("/media/uploads/2026/07/a.webp?x=1"))
      .toBe("uploads/2026/07/a.webp");
    expect(mediaKeyFromUrl("/media/backgrounds/home-hero.png")).toBeUndefined();
    expect(mediaKeyFromUrl("https://images.example/a.webp")).toBeUndefined();
  });

  it("extracts unique Markdown and HTML image keys in source order", () => {
    const source = [
      "![封面](/media/uploads/2026/07/a.webp)",
      '<img src="/media/uploads/2026/07/b.png" alt="正文">',
      "![重复](/media/uploads/2026/07/a.webp)",
      "[普通链接](/media/uploads/2026/07/not-an-image.webp)",
    ].join("\n");

    expect(extractManagedImageKeys(source)).toEqual([
      "uploads/2026/07/a.webp",
      "uploads/2026/07/b.png",
    ]);
  });
});
```

- [ ] **Step 2: Run the unit test and verify RED**

```powershell
npx vitest run tests/unit/post-images.test.ts
```

Expected: FAIL because `post-images.ts` is missing.

- [ ] **Step 3: Implement the minimal parser**

Create `src/lib/admin/post-images.ts`:

```ts
const managedPrefix = "uploads/";
const imageExtension = /\.(?:gif|jpe?g|png|webp)$/i;

export function mediaUrlFromKey(key: string): string {
  if (!key.startsWith(managedPrefix) || key.includes("..") || key.includes("\\")) {
    throw new Error("图片路径不正确。");
  }
  return `/media/${key}`;
}

export function mediaKeyFromUrl(value: string): string | undefined {
  const path = value.trim().split(/[?#]/, 1)[0] ?? "";
  const prefix = "/media/";
  if (!path.startsWith(prefix)) return undefined;
  const key = decodeURIComponent(path.slice(prefix.length));
  if (!key.startsWith(managedPrefix) || !imageExtension.test(key)) return undefined;
  if (key.includes("..") || key.includes("\\")) return undefined;
  return key;
}

export function extractManagedImageKeys(markdown: string): string[] {
  const urls: string[] = [];
  for (const match of markdown.matchAll(/!\[[^\]]*\]\((?:<)?([^\s)>]+)(?:>)?(?:\s+['"][^'"]*['"])?\)/g)) {
    if (match[1]) urls.push(match[1]);
  }
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"][^>]*>/gi)) {
    if (match[1]) urls.push(match[1]);
  }
  return [...new Set(urls.map(mediaKeyFromUrl).filter((key): key is string => Boolean(key)))];
}
```

- [ ] **Step 4: Run the test and verify GREEN**

```powershell
npx vitest run tests/unit/post-images.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/lib/admin/post-images.ts tests/unit/post-images.test.ts
git commit -m "feat: parse managed post images"
```

---

### Task 3: Build the D1 media repository

**Files:**
- Create: `zhaozhao-blog/src/lib/database/media-repository.ts`
- Modify: `zhaozhao-blog/tests/workers/media-repository.test.ts`

**Interfaces:**
- Produces `AdminMediaAsset` with `id`, `key`, `url`, `originalName`, `contentType`, `sizeBytes`, `usages`, and `sharedBy`.
- Produces `beginMediaUpload`, `markMediaReady`, `failMediaUpload`, `listPostAssets`, `resolvePostAssetSync`, `buildPostAssetSyncStatements`, `syncPostAssetLinks`, `removePostAsset`, `previewPostDelete`, `queuePostDelete`, and cleanup-job state functions.

- [ ] **Step 1: Add failing repository tests**

Extend `tests/workers/media-repository.test.ts` with tests that create two posts and one ready asset, then assert:

```ts
const asset = await beginMediaUpload(env.DB, {
  key: "uploads/2026/07/shared.png",
  originalName: "shared.png",
  contentType: "image/png",
  sizeBytes: 4,
  draftToken: "11111111-1111-4111-8111-111111111111",
});
await markMediaReady(env.DB, asset.id);
await syncPostAssetLinks(env.DB, first.id, {
  draftToken: "11111111-1111-4111-8111-111111111111",
  retainedAssetIds: [asset.id],
  inlineKeys: [asset.key],
});
await syncPostAssetLinks(env.DB, second.id, {
  retainedAssetIds: [asset.id],
  inlineKeys: [asset.key],
});

expect((await listPostAssets(env.DB, first.id))[0]).toMatchObject({
  usages: ["inline", "library"],
  sharedBy: 1,
});
```

Add a second test asserting `removePostAsset` returns a 409 conflict while `cover` or `inline` remains.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run --config vitest.workers.config.ts tests/workers/media-repository.test.ts
```

Expected: FAIL because the repository exports do not exist.

- [ ] **Step 3: Implement repository types and row mapping**

Create `src/lib/database/media-repository.ts` with these exact public interfaces:

```ts
export interface AdminMediaAsset {
  id: string;
  key: string;
  url: string;
  originalName: string;
  contentType: string;
  sizeBytes?: number;
  usages: Array<"library" | "cover" | "inline">;
  sharedBy: number;
}

export interface PostAssetSyncInput {
  draftToken?: string;
  retainedAssetIds: string[];
  coverAssetId?: string;
  inlineKeys: string[];
}

export interface ResolvedPostAssetSync {
  assets: AdminMediaAsset[];
  libraryAssetIds: string[];
  coverAssetId?: string;
  inlineAssetIds: string[];
  clearDraftAssetIds: string[];
}

export interface BeginMediaUploadInput {
  key: string;
  originalName: string;
  contentType: string;
  sizeBytes: number;
  draftToken?: string;
}

export interface PostDeletePreview {
  exclusive: number;
  shared: number;
}

export interface PostDeleteQueueResult {
  deleted: true;
  exclusiveImages: number;
  sharedImages: number;
  cleanupPending: number;
}

export function beginMediaUpload(
  database: D1Database,
  input: BeginMediaUploadInput,
): Promise<AdminMediaAsset>;
export function markMediaReady(
  database: D1Database,
  assetId: string,
  postId?: string,
): Promise<AdminMediaAsset>;
export function failMediaUpload(database: D1Database, assetId: string): Promise<void>;
```

Use `mediaUrlFromKey` from Task 2 and `database.withSession("first-primary")` for reads.

- [ ] **Step 4: Implement atomic link rebuilding**

`resolvePostAssetSync` and `buildPostAssetSyncStatements` must:

1. Resolve `retainedAssetIds`, `coverAssetId`, and `inlineKeys` to `state='ready'` assets.
2. Reject any requested asset that is missing, pending deletion, or has a mismatched `draft_token`.
3. Build the union of all requested assets as `library` links.
4. Return a duplicate-free resolved asset set plus prepared statements that delete the post's old links, insert rebuilt `library`, `cover`, and `inline` links, and clear matching draft tokens.

`syncPostAssetLinks` is the convenience wrapper for an existing post:

```ts
const resolved = await resolvePostAssetSync(database, input);
await database.batch(buildPostAssetSyncStatements(database, postId, resolved, new Date()));
return listPostAssets(database, postId);
```

Task 5 consumes the resolver and statement builder directly so the post row and image links share one D1 batch.

The cover insert must rely on `idx_post_asset_one_cover`, not application-only uniqueness.

- [ ] **Step 5: Implement safe remove and delete preview**

`removePostAsset` checks the current post's usages. If `cover` or `inline` exists, throw:

```ts
throw new AdminConflictError("请先从封面或正文移除这张图片并保存文章。", {
  usages: activeUsages,
});
```

Otherwise remove the `library` link. In the same D1 batch, use `NOT EXISTS` against all remaining links before marking the asset `pending_delete` and inserting a `manual_remove` cleanup job.

`previewPostDelete` must count `DISTINCT asset_id`, separating assets with another post link from assets used only by the target post.

- [ ] **Step 6: Implement cleanup job helpers**

Add:

```ts
export function listMediaCleanupJobs(database: D1Database, limit = 10): Promise<MediaCleanupJobRow[]>;
export function completeMediaCleanup(database: D1Database, assetId: string): Promise<void>;
export function failMediaCleanup(database: D1Database, assetId: string, message: string): Promise<void>;
export function queueDraftCleanup(database: D1Database, token: string, reason: "draft_cancelled" | "draft_expired"): Promise<number>;
```

`completeMediaCleanup` deletes `media_assets` only after all `post_asset_links` are gone.

- [ ] **Step 7: Run repository tests and verify GREEN**

```powershell
npx vitest run --config vitest.workers.config.ts tests/workers/media-repository.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/lib/database/media-repository.ts tests/workers/media-repository.test.ts
git commit -m "feat: track article image references"
```

---

### Task 4: Add KV upload and retryable cleanup services

**Files:**
- Create: `zhaozhao-blog/src/lib/cloudflare/post-media.ts`
- Modify: `zhaozhao-blog/src/lib/cloudflare/media.ts`
- Modify: `zhaozhao-blog/cloudflare-runtime.d.ts`
- Modify: `zhaozhao-blog/tests/workers/media.test.ts`

**Interfaces:**
- Consumes repository functions from Task 3.
- Produces `uploadPostImage(database, store, file, owner)`.
- Produces `runMediaCleanup(database, store, limit?)`.

- [ ] **Step 1: Write failing upload and cleanup tests**

Add tests for:

```ts
const asset = await uploadPostImage(env.DB, env.MEDIA, file, {
  draftToken: "22222222-2222-4222-8222-222222222222",
});
expect(asset).toMatchObject({
  originalName: "hero.png",
  contentType: "image/png",
  sizeBytes: 5,
  usages: [],
});
expect(await env.MEDIA.get(asset.key, "arrayBuffer")).not.toBeNull();
```

Create a fake store whose `delete()` throws once, assert the first cleanup leaves the job with `attempts: 1`, and the second cleanup completes it.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run --config vitest.workers.config.ts tests/workers/media.test.ts
```

Expected: FAIL because `post-media.ts` is missing.

- [ ] **Step 3: Extract shared image validation**

From `src/lib/cloudflare/media.ts`, export:

```ts
export const maxMediaBytes = 5 * 1024 * 1024;
export function validatedImageExtension(file: File): "jpg" | "png" | "webp" | "gif";
export function createMediaKey(extension: string, now = new Date()): string;
```

Keep `storeAdminMedia` behavior unchanged for page-setting images.

- [ ] **Step 4: Implement `uploadPostImage`**

Use the ordered state machine from the design:

```ts
export async function uploadPostImage(
  database: D1Database,
  store: KVNamespace,
  file: File,
  owner: { draftToken: string; postId?: never } | { postId: string; draftToken?: never },
): Promise<AdminMediaAsset>;
```

Insert `uploading`, write KV metadata `{ contentType, originalName, assetId }`, mark ready, and attach `library` immediately for a `postId`. On failure after KV write, queue `upload_failed` and invoke `runMediaCleanup` best-effort.

- [ ] **Step 5: Implement `runMediaCleanup`**

Define a narrow dependency for failure testing:

```ts
export interface MediaObjectStore {
  put(key: string, value: ArrayBuffer, options?: { metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
}
```

For each queued job, delete the KV key. Treat an already absent object as success. Call `completeMediaCleanup` on success and `failMediaCleanup` on error. Return `{ completed, failed }`.

- [ ] **Step 6: Update minimal KV runtime declarations**

Ensure `cloudflare-runtime.d.ts` includes `delete(key: string): Promise<void>` and metadata fields used by both legacy and article uploads.

- [ ] **Step 7: Run focused tests and verify GREEN**

```powershell
npx vitest run --config vitest.workers.config.ts tests/workers/media.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/lib/cloudflare/media.ts src/lib/cloudflare/post-media.ts cloudflare-runtime.d.ts tests/workers/media.test.ts
git commit -m "feat: upload and clean article images"
```

---

### Task 5: Make article create and update synchronize image references

**Files:**
- Modify: `zhaozhao-blog/src/lib/admin/schemas.ts`
- Modify: `zhaozhao-blog/src/lib/database/admin-repository.ts`
- Modify: `zhaozhao-blog/src/pages/api/admin/posts/index.ts`
- Modify: `zhaozhao-blog/src/pages/api/admin/posts/[id].ts`
- Modify: `zhaozhao-blog/tests/workers/admin-repository.test.ts`

**Interfaces:**
- Produces `postMediaInputSchema`.
- Produces `createPostWithMedia` and `updatePostWithMedia`.
- Consumes `extractManagedImageKeys`, `resolvePostAssetSync`, and `buildPostAssetSyncStatements`.

- [ ] **Step 1: Write failing post-save integration tests**

Create a ready draft asset, then call the desired API-level repository function:

```ts
const created = await createPostWithMedia(env.DB, postInput, {
  draftToken,
  coverAssetId: asset.id,
  retainedAssetIds: [asset.id],
});

expect(created.cover).toBe(`/media/${asset.key}`);
expect(await listPostAssets(env.DB, created.id)).toEqual([
  expect.objectContaining({ usages: ["cover", "library"] }),
]);
```

Add an update test that inserts the same URL into Markdown and expects `inline`, `cover`, and `library`. Add an invalid-token test expecting 409/validation failure.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run --config vitest.workers.config.ts tests/workers/admin-repository.test.ts
```

Expected: FAIL because media-aware post functions do not exist.

- [ ] **Step 3: Add media request validation**

In `src/lib/admin/schemas.ts` add:

```ts
export const postMediaInputSchema = z.object({
  draftToken: z.uuid().optional(),
  coverAssetId: z.uuid().optional(),
  retainedAssetIds: z.array(z.uuid()).max(100).default([]),
});

export type PostMediaInput = z.infer<typeof postMediaInputSchema>;
```

The flat JSON body is parsed once by `postInputSchema` and once by `postMediaInputSchema`, preserving the existing post fields.

- [ ] **Step 4: Implement media-aware save functions**

Add:

```ts
export async function createPostWithMedia(
  database: D1Database,
  input: PostInput,
  media: PostMediaInput,
): Promise<AdminPost>;

export async function updatePostWithMedia(
  database: D1Database,
  id: string,
  input: PostInput,
  media: PostMediaInput,
): Promise<AdminPost>;
```

Generate the new post ID before building statements. Derive `inlineKeys` from the parsed Markdown, call `resolvePostAssetSync`, then combine the post INSERT/UPDATE statement with `buildPostAssetSyncStatements(...)` in one `database.batch()`. When `coverAssetId` exists, derive and persist `posts.cover` from the resolved asset key; when it is absent, allow an unmanaged static/external `cover` string for compatibility.

- [ ] **Step 5: Update article APIs**

In both POST and PUT routes:

```ts
const body = await readAdminJson(request);
const post = postInputSchema.parse(body);
const media = postMediaInputSchema.parse(body);
```

Call `createPostWithMedia` or `updatePostWithMedia`. Do not change category/project generic APIs.

- [ ] **Step 6: Run focused tests and verify GREEN**

```powershell
npx vitest run --config vitest.workers.config.ts tests/workers/admin-repository.test.ts tests/workers/media-repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/admin/schemas.ts src/lib/database/admin-repository.ts src/pages/api/admin/posts tests/workers/admin-repository.test.ts
git commit -m "feat: save posts with managed images"
```

---

### Task 6: Add article image APIs and safe article deletion

**Files:**
- Create: `zhaozhao-blog/src/pages/api/admin/post-assets/index.ts`
- Create: `zhaozhao-blog/src/pages/api/admin/post-assets/drafts/[token].ts`
- Create: `zhaozhao-blog/src/pages/api/admin/posts/[id]/assets/index.ts`
- Create: `zhaozhao-blog/src/pages/api/admin/posts/[id]/assets/[assetId].ts`
- Create: `zhaozhao-blog/src/pages/api/admin/posts/[id]/delete-preview.ts`
- Modify: `zhaozhao-blog/src/pages/api/admin/posts/[id].ts`
- Modify: `zhaozhao-blog/src/lib/database/media-repository.ts`
- Test: `zhaozhao-blog/tests/workers/media-repository.test.ts`

**Interfaces:**
- Produces authenticated endpoints from the design.
- Produces `queuePostDelete(database, postId)` with in-transaction exclusivity checks.

- [ ] **Step 1: Write failing deletion lifecycle tests**

Create two posts sharing one asset plus one exclusive asset. Assert:

```ts
expect(await previewPostDelete(env.DB, first.id)).toEqual({ exclusive: 1, shared: 1 });
const queued = await queuePostDelete(env.DB, first.id);
expect(queued).toMatchObject({ deleted: true, cleanupPending: 1 });
expect(await env.MEDIA.get(shared.key, "arrayBuffer")).not.toBeNull();
```

After `runMediaCleanup`, assert the exclusive KV object and asset row are gone, while the shared object and second post link remain.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run --config vitest.workers.config.ts tests/workers/media-repository.test.ts
```

Expected: FAIL because delete queue behavior and routes are missing.

- [ ] **Step 3: Implement concurrency-safe `queuePostDelete`**

Do not use a pre-fetched exclusive asset list. In one D1 `batch()` use subqueries of this shape for both the state update and job insert:

```sql
WHERE link.post_id = ?
AND NOT EXISTS (
  SELECT 1 FROM post_asset_links other
  WHERE other.asset_id = link.asset_id
    AND other.post_id <> ?
)
```

Place SELECT count statements before the conditional mutations in the same batch, and return their results as the actual exclusive/shared counts. The final statement deletes the post.

- [ ] **Step 4: Implement authenticated article image routes**

Each route uses `handleAdminRequest`. Upload validates multipart form fields so exactly one of `draftToken` or `postId` is present, then calls `uploadPostImage` and runs at most five cleanup jobs. List returns `listPostAssets`. Remove calls `removePostAsset` then cleanup. Draft cancellation validates a UUID token and calls `queueDraftCleanup` followed by cleanup.

- [ ] **Step 5: Implement delete preview and media-aware DELETE**

`GET delete-preview` returns `previewPostDelete`. The existing article DELETE route calls `queuePostDelete`, then `runMediaCleanup`, and returns the counts computed by the DELETE transaction:

```ts
{
  deleted: true,
  exclusiveImages: queued.exclusiveImages,
  sharedImages: queued.sharedImages,
  cleanupPending: queued.cleanupPending,
}
```

`queuePostDelete` recomputes exclusivity inside its D1 batch. Never return or act on the earlier preview values.

- [ ] **Step 6: Run focused tests and verify GREEN**

```powershell
npx vitest run --config vitest.workers.config.ts tests/workers/media-repository.test.ts tests/workers/admin-repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/database/media-repository.ts src/pages/api/admin/post-assets src/pages/api/admin/posts tests/workers/media-repository.test.ts tests/workers/admin-repository.test.ts
git commit -m "feat: safely delete article images"
```

---

### Task 7: Backfill existing article images and upgrade backups

**Files:**
- Create: `zhaozhao-blog/src/pages/api/admin/post-assets/backfill.ts`
- Modify: `zhaozhao-blog/src/pages/api/admin/import.ts`
- Modify: `zhaozhao-blog/src/lib/cloudflare/post-media.ts`
- Modify: `zhaozhao-blog/src/lib/database/media-repository.ts`
- Modify: `zhaozhao-blog/src/lib/database/admin-repository.ts`
- Modify: `zhaozhao-blog/tests/workers/admin-repository.test.ts`
- Modify: `zhaozhao-blog/tests/workers/media-repository.test.ts`

**Interfaces:**
- Produces `backfillPostMedia(database, store): Promise<{ registered: number; linked: number; missing: string[] }>` in `src/lib/cloudflare/post-media.ts`.
- Produces backup schema version 2 while accepting version 1.

- [ ] **Step 1: Write failing backfill and backup tests**

Store a legacy KV image using `storeAdminMedia`, create a post whose body references its URL, then assert the desired backfill:

```ts
const result = await backfillPostMedia(env.DB, env.MEDIA);
expect(result).toEqual({ registered: 1, linked: 1, missing: [] });
expect((await listPostAssets(env.DB, post.id))[0]).toMatchObject({
  key: legacy.key,
  usages: ["inline", "library"],
});
```

Add backup tests asserting `schemaVersion: 2`, asset manifest entries keyed by `kvKey`, version-1 import acceptance, and version-2 restore canceling a pending cleanup job for a restored key.

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run --config vitest.workers.config.ts tests/workers/admin-repository.test.ts tests/workers/media-repository.test.ts
```

Expected: FAIL because backfill and backup v2 are missing.

- [ ] **Step 3: Implement idempotent backfill**

`backfillPostMedia` scans only post cover/body keys under `uploads/`. For each unique key:

1. Reuse an existing `media_assets` row by `kv_key`.
2. Otherwise call `getWithMetadata(key, "arrayBuffer")` to obtain metadata and optional size.
3. Skip missing objects and return their keys in `missing`.
4. Infer `originalName` from metadata or the key basename and MIME from metadata or extension.
5. Insert `ready` assets and rebuild `library`, `cover`, and `inline` links.

Do not scan `site_settings`, project covers, or `/media/backgrounds/`.

- [ ] **Step 4: Add the backfill endpoint**

`POST /api/admin/post-assets/backfill/` runs the idempotent backfill, then at most five cleanup jobs. It remains administrator-only and is safe to call on every first article-page load. Update `src/pages/api/admin/import.ts` so a successful version-1 import calls `backfillPostMedia(database, getMediaStore())`; version-2 imports restore D1 links directly and then run queued cleanup best-effort.

- [ ] **Step 5: Define backup version 2**

Use a discriminated union:

```ts
export interface BlogBackupV1 {
  schemaVersion: 1;
  exportedAt: string;
  settings: Record<string, unknown>;
  categories: AdminCategory[];
  posts: AdminPost[];
  projects: AdminProject[];
  friends: AdminFriend[];
  friendPage: unknown;
  messages: AdminMessage[];
}

export interface BlogBackupV2 extends Omit<BlogBackupV1, "schemaVersion"> {
  schemaVersion: 2;
  mediaAssets: Array<{
    kvKey: string;
    originalName: string;
    contentType: string;
    sizeBytes?: number;
  }>;
  postAssetLinks: Array<{
    postId: string;
    kvKey: string;
    usage: "library" | "cover" | "inline";
    sortOrder: number;
  }>;
}

export type BlogBackup = BlogBackupV1 | BlogBackupV2;
```

Export only `state='ready'` assets with links. During v2 import, match by `kv_key`, replace post links, cancel cleanup jobs for imported keys, and queue only final unreferenced old keys as `backup_restore` in the same D1 transaction. During v1 import, run the same URL extraction/backfill rules after content insertion.

- [ ] **Step 6: Run focused tests and verify GREEN**

```powershell
npx vitest run --config vitest.workers.config.ts tests/workers/admin-repository.test.ts tests/workers/media-repository.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/pages/api/admin/post-assets/backfill.ts src/pages/api/admin/import.ts src/lib/cloudflare/post-media.ts src/lib/database/media-repository.ts src/lib/database/admin-repository.ts tests/workers/admin-repository.test.ts tests/workers/media-repository.test.ts
git commit -m "feat: backfill and back up article images"
```

---

### Task 8: Convert Markdown import into an editor preview

**Files:**
- Modify: `zhaozhao-blog/src/pages/api/admin/posts/import.ts`
- Modify: `zhaozhao-blog/src/scripts/admin-post-import.ts`
- Modify: `zhaozhao-blog/src/lib/admin/markdown-import.ts`
- Modify: `zhaozhao-blog/tests/unit/markdown-import.test.ts`

**Interfaces:**
- Import endpoint returns parsed post data and relative image paths; it does not create a post.
- Produces `findRelativeMarkdownImages(body: string): string[]`.

- [ ] **Step 1: Write failing import-preview tests**

Add:

```ts
expect(findRelativeMarkdownImages([
  "![本地](./images/local.png)",
  "![本站](/media/uploads/2026/07/a.webp)",
  "![外部](https://images.example/a.webp)",
].join("\n"))).toEqual(["./images/local.png"]);
```

Also test the pure preview helper:

```ts
const preview = buildMarkdownImportPreview("hello.md", source, now);
expect(preview).toEqual({
  post: expect.objectContaining({ slug: "hello", draft: true }),
  relativeImages: ["./images/local.png"],
});
```

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run tests/unit/markdown-import.test.ts
```

Expected: FAIL because `findRelativeMarkdownImages` and `buildMarkdownImportPreview` are missing.

- [ ] **Step 3: Implement relative-image detection**

Reuse Markdown image token matching from `post-images.ts`, but return URLs that do not start with `/`, `http://`, `https://`, or `data:`. Deduplicate in source order. `buildMarkdownImportPreview` returns `{ post: parseMarkdownPostImport(...), relativeImages: findRelativeMarkdownImages(post.body) }`.

- [ ] **Step 4: Change the import endpoint contract**

Replace `createPost(...)` with:

```ts
return buildMarkdownImportPreview(file.name, await file.text());
```

- [ ] **Step 5: Fill the form instead of reloading**

`admin-post-import.ts` dispatches:

```ts
document.dispatchEvent(new CustomEvent("admin:post-imported", {
  detail: result.data,
}));
```

Show `发现 N 个待上传的本地图片` when `relativeImages` is non-empty. Do not save or reload.

- [ ] **Step 6: Run tests and verify GREEN**

```powershell
npx vitest run tests/unit/markdown-import.test.ts
```

Expected: PASS. Route behavior is covered by the browser test in Task 10.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/admin/markdown-import.ts src/pages/api/admin/posts/import.ts src/scripts/admin-post-import.ts tests/unit/markdown-import.test.ts
git commit -m "feat: preview markdown imports"
```

---

### Task 9: Build the article-specific editor and image manager

**Files:**
- Modify: `zhaozhao-blog/src/pages/admin/posts.astro`
- Create: `zhaozhao-blog/src/scripts/admin-post-editor.ts`
- Create: `zhaozhao-blog/src/scripts/admin-post-media.ts`
- Modify: `zhaozhao-blog/src/layouts/AdminLayout.astro`
- Modify: `zhaozhao-blog/src/styles/admin.css`
- Modify: `zhaozhao-blog/tests/unit/authoring.test.ts`

**Interfaces:**
- `admin-post-editor.ts` owns article CRUD and emits `admin:post-context`.
- `admin-post-media.ts` owns uploads/gallery and emits `admin:post-media-changed`.
- Imported Markdown arrives through `admin:post-imported` from Task 8.

- [ ] **Step 1: Write failing authoring structure tests**

In `tests/unit/authoring.test.ts`, assert:

```ts
expect(postsPage).toContain("data-post-page");
expect(postsPage).toContain("data-post-cover-upload");
expect(postsPage).toContain("data-post-inline-upload");
expect(postsPage).toContain("data-post-media-list");
expect(postsPage).not.toContain('name="cover" /></div>');
expect(existsSync(resolve(appRoot, "src/scripts/admin-post-editor.ts"))).toBe(true);
expect(existsSync(resolve(appRoot, "src/scripts/admin-post-media.ts"))).toBe(true);
```

- [ ] **Step 2: Run and verify RED**

```powershell
npx vitest run tests/unit/authoring.test.ts
```

Expected: FAIL because the new markup and scripts are missing.

- [ ] **Step 3: Replace generic post-page markup**

In `posts.astro`:

- replace `data-record-page` with `data-post-page` so `admin-records.ts` ignores articles;
- add hidden `id`, `draftToken`, `coverAssetId`, and `retainedAssetIds` controls;
- keep an advanced read-only cover path display for compatibility;
- add cover drop zone, preview, alt field, upload/replace/remove buttons;
- add Markdown toolbar with “上传并插入图片” and a multi-image file input;
- add the article image list with an empty state;
- add a delete dialog element showing exclusive/shared counts.

- [ ] **Step 4: Implement `admin-post-editor.ts`**

Required behaviors:

```ts
type PostContext = { postId?: string; draftToken: string };
```

- New article uses `crypto.randomUUID()`.
- Title updates Slug through the existing slug rules until the user edits Slug manually.
- Edit loads `/api/admin/posts/:id/` plus `/assets/`, populates fields, and emits context.
- Submit serializes the existing post fields plus `draftToken`, `coverAssetId`, and `retainedAssetIds`.
- Import event populates fields without saving.
- Cancel calls the draft DELETE endpoint before resetting a new unsaved article.
- Delete first fetches `delete-preview`, fills the dialog, and only then sends DELETE.

- [ ] **Step 5: Implement `admin-post-media.ts`**

- Upload `FormData(file, postId|draftToken)` to `/api/admin/post-assets/`.
- Insert Markdown at `textarea.selectionStart` and restore focus.
- Always retain uploaded/inserted/cover assets in the gallery ID set.
- “设为封面” sets `coverAssetId`, derived cover URL, preview, and focuses alt text.
- “从本文移除” calls the remove endpoint for saved posts. For unsaved posts it removes the asset ID from the retained set; the unmatched draft asset is removed by cancel or 24-hour expiry instead of being attached on save.
- Show thumbnail, filename, formatted size, usages, and `被其他 N 篇文章使用`.
- On first page load call the idempotent backfill endpoint once, then refresh the selected post's image list if it registered legacy images.

- [ ] **Step 6: Load scripts only on the admin bundle**

Add imports to `AdminLayout.astro`:

```astro
import "../scripts/admin-post-editor";
import "../scripts/admin-post-media";
```

Both scripts must no-op when `[data-post-page]` is absent.

- [ ] **Step 7: Add responsive styles**

Create focused classes for `.admin-post-editor`, `.admin-post-cover`, `.admin-post-toolbar`, `.admin-post-media-grid`, `.admin-post-media-card`, progress/error states, and the delete dialog. At `max-width: 1050px`, switch to one column; at `max-width: 760px`, keep upload buttons at least 44px high and media cards readable at 320px viewport width.

- [ ] **Step 8: Run unit checks and build**

```powershell
npx vitest run tests/unit/authoring.test.ts tests/unit/markdown-import.test.ts
npm run check
npm run build
```

Expected: tests PASS, check reports 0 errors, build completes.

- [ ] **Step 9: Commit**

```powershell
git add src/pages/admin/posts.astro src/scripts/admin-post-editor.ts src/scripts/admin-post-media.ts src/layouts/AdminLayout.astro src/styles/admin.css tests/unit/authoring.test.ts
git commit -m "feat: add article image editor"
```

---

### Task 10: Add end-to-end coverage, documentation, and Cloudflare rollout checks

**Files:**
- Modify: `zhaozhao-blog/tests/e2e/admin.spec.ts`
- Modify: `zhaozhao-blog/docs/CONTENT-MAINTENANCE.md`
- Modify: `zhaozhao-blog/AUTHORING.md`
- Modify: `zhaozhao-blog/docs/CLOUDFLARE-DEPLOYMENT.md`

**Interfaces:**
- Verifies the complete public/admin behavior produced by Tasks 1–9.

- [ ] **Step 1: Add stable image fixtures**

Add two tiny PNG fixtures under `tests/fixtures/`, each below 10 KiB and visually distinct. Do not use existing production artwork, so deletion tests cannot affect seeded content.

- [ ] **Step 2: Write the failing Playwright workflow**

Add a test that:

1. Logs in using the existing helper.
2. Opens `/admin/posts/` and clicks “新建文章”.
3. Fills title, category, tags, date, summary, and body.
4. Uploads `tests/fixtures/post-cover.png` as cover and supplies alt text.
5. Uploads `tests/fixtures/post-inline.png` and verifies Markdown insertion.
6. Saves and opens the public article, asserting both images render.
7. Creates a second post reusing the first inline image URL.
8. Deletes the first post and verifies the dialog reports one shared image.
9. Polls a cache-busted exclusive image URL until it returns 404 or the cleanup job disappears, with a bounded 60-second timeout.
10. Verifies the shared image still returns 200.

Use the planned selectors directly:

```ts
test("administrator manages article images", async ({ page, request }) => {
  const slug = `article-images-${Date.now()}`;
  const sharedSlug = `${slug}-shared`;
  await page.goto("/admin/");
  await page.getByLabel("管理员密码").fill("233zhao-local-admin");
  await page.getByRole("button", { name: "进入后台" }).click();
  await page.goto("/admin/posts/");
  await page.getByRole("button", { name: "新建文章" }).click();
  await page.getByLabel("标题").fill("文章图片端到端测试");
  await page.getByLabel("Slug").fill(slug);
  await page.getByLabel("摘要").fill("验证封面、正文图片、共享引用与删除清理。");
  await page.getByLabel("分类").selectOption({ label: "开发" });
  await page.getByLabel("标签").fill("测试, 图片");
  await page.getByLabel("发布日期").fill("2026-07-17");
  await page.getByLabel("Markdown 正文").fill("正文开始。\n");
  await page.locator("[data-post-cover-upload]").setInputFiles("tests/fixtures/post-cover.png");
  await page.getByLabel("封面说明").fill("端到端测试封面");
  await page.locator("[data-post-inline-upload]").setInputFiles("tests/fixtures/post-inline.png");
  await expect(page.getByLabel("Markdown 正文")).toHaveValue(/!\[.*\]\(\/media\/uploads\//);
  const body = await page.getByLabel("Markdown 正文").inputValue();
  const inlineUrl = body.match(/\((\/media\/uploads\/[^)]+)\)/)?.[1];
  const coverUrl = await page.locator("[data-post-cover-preview] img").getAttribute("src");
  if (!inlineUrl || !coverUrl) throw new Error("文章图片 URL 未生成。");
  await page.getByRole("button", { name: "保存文章" }).click();
  await expect(page.locator("tr").filter({ hasText: "文章图片端到端测试" })).toBeVisible();

  await page.goto(`/posts/${slug}/`);
  await expect(page.getByAltText("端到端测试封面")).toBeVisible();
  await expect(page.locator(`img[src^="${inlineUrl}"]`)).toBeVisible();

  await page.goto("/admin/posts/");
  await page.getByRole("button", { name: "新建文章" }).click();
  await page.getByLabel("标题").fill("共享文章图片端到端测试");
  await page.getByLabel("Slug").fill(sharedSlug);
  await page.getByLabel("摘要").fill("验证共享图片在删除其他文章后继续保留。");
  await page.getByLabel("分类").selectOption({ label: "开发" });
  await page.getByLabel("标签").fill("测试, 共享图片");
  await page.getByLabel("发布日期").fill("2026-07-17");
  await page.getByLabel("Markdown 正文").fill(`![共享图片](${inlineUrl})`);
  await page.getByRole("button", { name: "保存文章" }).click();

  const firstRow = page.locator("tr").filter({ hasText: "文章图片端到端测试" });
  await firstRow.getByRole("button", { name: "删除" }).click();
  const deleteDialog = page.locator("[data-post-delete-dialog]");
  await expect(deleteDialog).toContainText("共享图片：1 张");
  await deleteDialog.locator("[data-confirm-post-delete]").click();
  await expect(firstRow).toHaveCount(0);

  await expect.poll(async () => (
    await request.get(`${coverUrl}?cleanup=${Date.now()}`)
  ).status(), { timeout: 60_000 }).toBe(404);
  expect((await request.get(`${inlineUrl}?shared=${Date.now()}`)).status()).toBe(200);

  const sharedRow = page.locator("tr").filter({ hasText: "共享文章图片端到端测试" });
  await sharedRow.getByRole("button", { name: "删除" }).click();
  await page.locator("[data-post-delete-dialog] [data-confirm-post-delete]").click();
  await expect(sharedRow).toHaveCount(0);
});
```

Replace the existing Markdown-import assertion in the same file: after choosing the Markdown file, assert the form is populated and then click “保存文章” before expecting a table row.

- [ ] **Step 3: Run the focused E2E test and verify RED**

```powershell
npx playwright test tests/e2e/admin.spec.ts --grep "article images"
```

Expected: FAIL before all UI/API integration is complete.

- [ ] **Step 4: Make E2E assertions eventual-consistency aware**

Use `expect.poll` for cleanup state or a cache-busted URL. Do not assert an immediate 404 from an immutable cached URL. Keep shared-image checks immediate because the key must never enter the cleanup queue.

- [ ] **Step 5: Update administrator documentation**

Document:

- how to create a post and when Slug is generated;
- cover upload and alt text;
- inline image insertion;
- shared-image behavior;
- deletion preview and cleanup retry semantics;
- Markdown import preview and relative-image replacement;
- backup v2 contains only media metadata, so KV images require a separate storage backup.

- [ ] **Step 6: Run the complete verification suite**

```powershell
npm run cf:typegen
npm run check
npm test
npm run build
npm run test:e2e
npx wrangler deploy --dry-run
```

Expected:

- `npm run check`: 0 errors;
- unit tests: all pass;
- Workers tests: all pass;
- Playwright: all expected projects pass, existing intentional skips remain skipped;
- dry-run lists `MEDIA` as KV and `DB` as D1.

- [ ] **Step 7: Apply the remote migration and deploy**

```powershell
npx wrangler d1 migrations apply zhaozhao-blog --remote
npm run deploy
```

Expected: `0004_post_media.sql` applies successfully and Wrangler prints the production Worker URL.

- [ ] **Step 8: Run production smoke checks**

Verify:

```text
GET  /                         -> 200
GET  /admin/posts/             -> 302 without session, 200 with session
POST /api/admin/post-assets/   -> 401 without session
GET  /rss.xml                  -> 200
```

Log in, open `/admin/posts/` once to trigger idempotent legacy backfill, create a draft with one image, remove it, and confirm the cleanup count returns to zero.

- [ ] **Step 9: Commit and push**

```powershell
git add tests/e2e tests/fixtures docs/CONTENT-MAINTENANCE.md AUTHORING.md docs/CLOUDFLARE-DEPLOYMENT.md
git commit -m "test: cover article image lifecycle"
git push origin master
```

---

## Plan Self-Review Results

- **Spec coverage:** Schema, upload, temporary drafts, cover persistence, inline extraction, shared references, safe deletion, cleanup retries, legacy backfill, backup v2, Markdown preview, responsive UI, tests, and Cloudflare rollout each map to a task.
- **Placeholder scan:** No unfinished marker or undefined implementation step remains. Braced IDs are example values, not unfinished requirements.
- **Type consistency:** The plan consistently uses `AdminMediaAsset`, `PostAssetSyncInput`, `ResolvedPostAssetSync`, `postMediaInputSchema`, `uploadPostImage`, `runMediaCleanup`, `backfillPostMedia`, and `/api/admin/post-assets/`.
- **Scope control:** Only article images use the new lifecycle. Existing page-setting image uploads remain on `/api/admin/media/`.
