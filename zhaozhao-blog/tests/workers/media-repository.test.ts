import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { ADMIN_SESSION_COOKIE, createAdminSession } from "../../src/lib/admin/auth";
import { runMediaCleanup } from "../../src/lib/cloudflare/post-media";
import {
  AdminConflictError,
  AdminNotFoundError,
  createPost,
} from "../../src/lib/database/admin-repository";
import {
  beginMediaUpload,
  buildPostAssetSyncStatements,
  completeMediaCleanup,
  discardMediaUpload,
  failMediaCleanup,
  failMediaUpload,
  listMediaCleanupJobs,
  listPostAssets,
  markMediaReady,
  previewPostDelete,
  queuePostDelete,
  queueDraftCleanup,
  removePostAsset,
  resolvePostAssetSync,
  syncPostAssetLinks,
} from "../../src/lib/database/media-repository";

const draftToken = "11111111-1111-4111-8111-111111111111";

async function createTestPost(slug: string) {
  return createPost(env.DB, {
    slug,
    title: slug,
    description: "Media repository test post.",
    body: "Test body.",
    publishedAt: "2026-07-17T00:00:00.000Z",
    draft: true,
    category: "开发",
    tags: ["test"],
    featured: false,
  });
}

async function adminRequest(path: string, method: string, body?: BodyInit): Promise<Request> {
  const session = await createAdminSession(env.DB, undefined, undefined, env.ADMIN_SESSION_SECRET);
  return new Request(`https://example.test${path}`, {
    method,
    headers: { cookie: `${ADMIN_SESSION_COOKIE}=${session.token}` },
    body,
  });
}

function databaseWithBeforeBatch(operation: () => Promise<void>): D1Database {
  let raced = false;
  return {
    prepare: (...args: Parameters<D1Database["prepare"]>) => env.DB.prepare(...args),
    withSession: (...args: Parameters<D1Database["withSession"]>) => env.DB.withSession(...args),
    batch: async <T>(statements: D1PreparedStatement[]) => {
      if (!raced) {
        raced = true;
        await operation();
      }
      return env.DB.batch<T>(statements);
    },
  } as D1Database;
}

async function insertReadyAssets(
  count: number,
  prefix: string,
  assetDraftToken?: string,
) {
  const assets = Array.from({ length: count }, (_, index) => ({
    id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    key: `uploads/2026/07/${prefix}-${index}.png`,
  }));
  await env.DB.batch(assets.map(({ id, key }) => env.DB.prepare(
    `INSERT INTO media_assets
     (id, kv_key, original_name, content_type, size_bytes, state, draft_token, created_at)
     VALUES (?, ?, ?, 'image/png', 4, 'ready', ?, ?)`,
  ).bind(
    id,
    key,
    `${prefix}.png`,
    assetDraftToken ?? null,
    "2026-07-17T00:00:00.000Z",
  )));
  return assets;
}

describe("article media schema", () => {
  it("uploads an article image through the authenticated asset API", async () => {
    const { POST } = await import("../../src/pages/api/admin/post-assets/index");
    const form = new FormData();
    form.set("file", new File(["image"], "route-upload.png", { type: "image/png" }));
    form.set("draftToken", draftToken);

    const response = await POST({
      request: await adminRequest("/api/admin/post-assets/", "POST", form),
    } as never);

    expect(response.status).toBe(200);
    const payload = await response.json() as {
      data: { asset: { id: string; key: string } };
    };
    expect(payload.data.asset).toMatchObject({
      id: expect.any(String),
      key: expect.stringMatching(/^uploads\//),
    });
    expect(await env.MEDIA.get(payload.data.asset.key, "arrayBuffer")).not.toBeNull();
  });

  it.each([
    ["neither owner", {}],
    ["both owners", { draftToken, postId: "22222222-2222-4222-8222-222222222222" }],
  ])("rejects an upload with %s", async (_case, owner) => {
    const { POST } = await import("../../src/pages/api/admin/post-assets/index");
    const form = new FormData();
    form.set("file", new File(["image"], "invalid-owner.png", { type: "image/png" }));
    for (const [key, value] of Object.entries(owner)) form.set(key, value);

    const response = await POST({
      request: await adminRequest("/api/admin/post-assets/", "POST", form),
    } as never);

    expect(response.status).toBe(422);
  });

  it("lists the images attached to an article through the asset API", async () => {
    const { GET } = await import("../../src/pages/api/admin/posts/[id]/assets/index");
    const post = await createTestPost("route-list-assets");
    const [asset] = await insertReadyAssets(1, "route-list-assets");
    await syncPostAssetLinks(env.DB, post.id, {
      retainedAssetIds: [asset!.id],
      inlineKeys: [],
    });

    const response = await GET({
      request: await adminRequest(`/api/admin/posts/${post.id}/assets/`, "GET"),
      params: { id: post.id },
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: [{ id: asset!.id, usages: ["library"] }],
    });
  });

  it("removes and cleans an article library image through the asset API", async () => {
    const { DELETE } = await import("../../src/pages/api/admin/posts/[id]/assets/[assetId]");
    const post = await createTestPost("route-remove-asset");
    const [asset] = await insertReadyAssets(1, "route-remove-asset");
    await syncPostAssetLinks(env.DB, post.id, {
      retainedAssetIds: [asset!.id],
      inlineKeys: [],
    });
    await env.MEDIA.put(asset!.key, "image");

    const response = await DELETE({
      request: await adminRequest(
        `/api/admin/posts/${post.id}/assets/${asset!.id}/`,
        "DELETE",
      ),
      params: { id: post.id, assetId: asset!.id },
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { removed: true } });
    expect(await env.MEDIA.get(asset!.key, "arrayBuffer")).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM media_assets WHERE id = ?")
      .bind(asset!.id).first()).toBeNull();
  });

  it("cancels and cleans a draft editing session through the asset API", async () => {
    const { DELETE } = await import("../../src/pages/api/admin/post-assets/drafts/[token]");
    const asset = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/route-cancel-draft.png",
      originalName: "route-cancel-draft.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });
    await markMediaReady(env.DB, asset.id);
    await env.MEDIA.put(asset.key, "image");

    const response = await DELETE({
      request: await adminRequest(`/api/admin/post-assets/drafts/${draftToken}/`, "DELETE"),
      params: { token: draftToken },
    } as never);

    expect(response.status).toBe(200);
    expect(await env.MEDIA.get(asset.key, "arrayBuffer")).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM media_assets WHERE id = ?")
      .bind(asset.id).first()).toBeNull();
  });

  it("rejects a non-UUID draft cancellation token", async () => {
    const { DELETE } = await import("../../src/pages/api/admin/post-assets/drafts/[token]");
    const response = await DELETE({
      request: await adminRequest("/api/admin/post-assets/drafts/not-a-uuid/", "DELETE"),
      params: { token: "not-a-uuid" },
    } as never);

    expect(response.status).toBe(422);
  });

  it("previews distinct exclusive images through the article delete API", async () => {
    const { GET } = await import("../../src/pages/api/admin/posts/[id]/delete-preview");
    const post = await createTestPost("route-delete-preview");
    const [asset] = await insertReadyAssets(1, "route-delete-preview");
    await syncPostAssetLinks(env.DB, post.id, {
      retainedAssetIds: [asset!.id],
      coverAssetId: asset!.id,
      inlineKeys: [asset!.key],
    });

    const response = await GET({
      request: await adminRequest(`/api/admin/posts/${post.id}/delete-preview/`, "GET"),
      params: { id: post.id },
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { exclusive: 1, shared: 0 } });
  });

  it("deletes an article with transaction counts and media cleanup", async () => {
    const { DELETE } = await import("../../src/pages/api/admin/posts/[id]");
    const post = await createTestPost("route-delete-with-media");
    const [asset] = await insertReadyAssets(1, "route-delete-with-media");
    await syncPostAssetLinks(env.DB, post.id, {
      retainedAssetIds: [asset!.id],
      inlineKeys: [],
    });
    await env.MEDIA.put(asset!.key, "image");

    const response = await DELETE({
      request: await adminRequest(`/api/admin/posts/${post.id}/`, "DELETE"),
      params: { id: post.id },
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: {
        deleted: true,
        exclusiveImages: 1,
        sharedImages: 0,
        cleanupPending: 1,
      },
    });
    expect(await env.MEDIA.get(asset!.key, "arrayBuffer")).toBeNull();
  });

  it("creates media assets, post links, and cleanup jobs", async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const names = tables.results.map(({ name }) => name);

    expect(names).toContain("media_assets");
    expect(names).toContain("post_asset_links");
    expect(names).toContain("media_cleanup_jobs");
  });

  it("tracks shared inline assets as library assets for each post", async () => {
    const first = await createTestPost("shared-media-first");
    const second = await createTestPost("shared-media-second");
    const asset = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/shared.png",
      originalName: "shared.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });
    await markMediaReady(env.DB, asset.id);
    await syncPostAssetLinks(env.DB, first.id, {
      draftToken,
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
  });

  it("discards only uploading assets after an object write failure", async () => {
    const uploading = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/discard-uploading.png",
      originalName: "discard-uploading.png",
      contentType: "image/png",
      sizeBytes: 4,
    });
    const ready = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/keep-ready.png",
      originalName: "keep-ready.png",
      contentType: "image/png",
      sizeBytes: 4,
    });
    await markMediaReady(env.DB, ready.id);

    await discardMediaUpload(env.DB, uploading.id);
    expect(await env.DB.prepare("SELECT id FROM media_assets WHERE id = ?")
      .bind(uploading.id).first()).toBeNull();
    await expect(discardMediaUpload(env.DB, ready.id))
      .rejects.toBeInstanceOf(AdminConflictError);
    expect(await env.DB.prepare("SELECT state FROM media_assets WHERE id = ?")
      .bind(ready.id).first()).toEqual({ state: "ready" });
  });

  it("attaches a ready upload directly to its owning post", async () => {
    const post = await createTestPost("direct-ready-owner");
    const asset = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/direct-ready.png",
      originalName: "direct-ready.png",
      contentType: "image/png",
      sizeBytes: 4,
    });

    expect(await markMediaReady(env.DB, asset.id, post.id)).toMatchObject({
      usages: ["library"],
      sharedBy: 0,
    });
  });

  it("rejects library removal while cover or inline usage remains", async () => {
    const post = await createTestPost("active-media-usages");
    const asset = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/active.png",
      originalName: "active.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });
    await markMediaReady(env.DB, asset.id);
    await syncPostAssetLinks(env.DB, post.id, {
      draftToken,
      retainedAssetIds: [asset.id],
      coverAssetId: asset.id,
      inlineKeys: [asset.key],
    });

    const removal = removePostAsset(env.DB, post.id, asset.id);
    await expect(removal).rejects.toMatchObject({
      name: "AdminConflictError",
      details: { usages: ["cover", "inline"] },
    });
    await expect(removal).rejects.toBeInstanceOf(AdminConflictError);
  });

  it("deletes a post and cleans only its exclusive assets", async () => {
    const first = await createTestPost("delete-preview-first");
    const second = await createTestPost("delete-preview-second");
    const shared = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/preview-shared.png",
      originalName: "preview-shared.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });
    const exclusive = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/preview-exclusive.png",
      originalName: "preview-exclusive.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });
    await markMediaReady(env.DB, shared.id);
    await markMediaReady(env.DB, exclusive.id);
    await env.MEDIA.put(shared.key, "shared");
    await env.MEDIA.put(exclusive.key, "exclusive");
    await syncPostAssetLinks(env.DB, first.id, {
      draftToken,
      retainedAssetIds: [shared.id, exclusive.id],
      coverAssetId: exclusive.id,
      inlineKeys: [shared.key],
    });
    await syncPostAssetLinks(env.DB, second.id, {
      retainedAssetIds: [shared.id],
      inlineKeys: [],
    });

    expect(await previewPostDelete(env.DB, first.id)).toEqual({
      exclusive: 1,
      shared: 1,
    });
    expect(await queuePostDelete(env.DB, first.id)).toEqual({
      deleted: true,
      exclusiveImages: 1,
      sharedImages: 1,
      cleanupPending: 1,
    });
    expect(await env.MEDIA.get(shared.key, "arrayBuffer")).not.toBeNull();

    expect(await runMediaCleanup(env.DB, env.MEDIA)).toEqual({
      completed: 1,
      failed: 0,
    });
    expect(await env.MEDIA.get(exclusive.key, "arrayBuffer")).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM media_assets WHERE id = ?")
      .bind(exclusive.id).first()).toBeNull();
    expect(await env.MEDIA.get(shared.key, "arrayBuffer")).not.toBeNull();
    expect(await env.DB.prepare("SELECT state FROM media_assets WHERE id = ?")
      .bind(shared.id).first()).toEqual({ state: "ready" });
    expect((await listPostAssets(env.DB, second.id)).map(({ id }) => id)).toEqual([shared.id]);
  });

  it("recomputes exclusivity inside the article deletion batch", async () => {
    const first = await createTestPost("delete-race-first");
    const second = await createTestPost("delete-race-second");
    const [asset] = await insertReadyAssets(1, "delete-race");
    await syncPostAssetLinks(env.DB, first.id, {
      retainedAssetIds: [asset!.id],
      inlineKeys: [],
    });
    expect(await previewPostDelete(env.DB, first.id)).toEqual({ exclusive: 1, shared: 0 });

    const database = databaseWithBeforeBatch(async () => {
      await env.DB.prepare(
        `INSERT INTO post_asset_links (post_id, asset_id, usage, sort_order, created_at)
         VALUES (?, ?, 'library', 0, ?)`,
      ).bind(second.id, asset!.id, new Date().toISOString()).run();
    });

    expect(await queuePostDelete(database, first.id)).toEqual({
      deleted: true,
      exclusiveImages: 0,
      sharedImages: 1,
      cleanupPending: 0,
    });
    expect(await listMediaCleanupJobs(env.DB)).toEqual([]);
    expect((await listPostAssets(env.DB, second.id))[0]).toMatchObject({
      id: asset!.id,
      sharedBy: 0,
    });
    expect(await env.DB.prepare("SELECT state FROM media_assets WHERE id = ?")
      .bind(asset!.id).first()).toEqual({ state: "ready" });
  });

  it("queues and advances cleanup after the final library link is removed", async () => {
    const post = await createTestPost("manual-cleanup");
    const asset = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/manual-cleanup.png",
      originalName: "manual-cleanup.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });
    await markMediaReady(env.DB, asset.id);
    await syncPostAssetLinks(env.DB, post.id, {
      draftToken,
      retainedAssetIds: [asset.id],
      inlineKeys: [],
    });

    await removePostAsset(env.DB, post.id, asset.id);
    expect(await listMediaCleanupJobs(env.DB)).toMatchObject([
      { asset_id: asset.id, reason: "manual_remove", attempts: 0 },
    ]);

    await failMediaCleanup(env.DB, asset.id, "temporary failure");
    expect((await listMediaCleanupJobs(env.DB))[0]).toMatchObject({
      attempts: 1,
      last_error: "temporary failure",
    });

    await completeMediaCleanup(env.DB, asset.id);
    expect(await listMediaCleanupJobs(env.DB)).toEqual([]);
    expect(await env.DB.prepare("SELECT id FROM media_assets WHERE id = ?")
      .bind(asset.id).first()).toBeNull();
  });

  it("queues failed uploads and abandoned draft assets", async () => {
    const failed = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/failed-upload.png",
      originalName: "failed-upload.png",
      contentType: "image/png",
      sizeBytes: 4,
    });
    const abandoned = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/abandoned-draft.png",
      originalName: "abandoned-draft.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });
    await markMediaReady(env.DB, abandoned.id);

    await failMediaUpload(env.DB, failed.id);
    expect(await queueDraftCleanup(env.DB, draftToken, "draft_cancelled")).toBe(1);
    expect(await queueDraftCleanup(env.DB, draftToken, "draft_cancelled")).toBe(0);
    expect((await listMediaCleanupJobs(env.DB)).map(({ reason }) => reason).sort()).toEqual([
      "draft_cancelled",
      "upload_failed",
    ]);
  });

  it("rejects missing, uploading, pending, and mismatched draft assets", async () => {
    const post = await createTestPost("invalid-asset-state");
    const uploading = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/still-uploading.png",
      originalName: "still-uploading.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });

    await expect(syncPostAssetLinks(env.DB, post.id, {
      draftToken,
      retainedAssetIds: [uploading.id],
      inlineKeys: [],
    })).rejects.toBeInstanceOf(AdminConflictError);

    await markMediaReady(env.DB, uploading.id);
    await env.DB.prepare("UPDATE media_assets SET state = 'pending_delete' WHERE id = ?")
      .bind(uploading.id).run();
    await expect(syncPostAssetLinks(env.DB, post.id, {
      draftToken,
      retainedAssetIds: [uploading.id],
      inlineKeys: [],
    })).rejects.toBeInstanceOf(AdminConflictError);

    const mismatched = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/wrong-draft.png",
      originalName: "wrong-draft.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken: "22222222-2222-4222-8222-222222222222",
    });
    await markMediaReady(env.DB, mismatched.id);
    await expect(syncPostAssetLinks(env.DB, post.id, {
      draftToken,
      retainedAssetIds: [mismatched.id],
      inlineKeys: [],
    })).rejects.toBeInstanceOf(AdminConflictError);

    await expect(syncPostAssetLinks(env.DB, post.id, {
      retainedAssetIds: ["33333333-3333-4333-8333-333333333333"],
      inlineKeys: [],
    })).rejects.toBeInstanceOf(Error);
  });

  it("rolls back mark-ready attachment when state changes before its batch", async () => {
    const post = await createTestPost("mark-ready-race");
    const asset = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/mark-ready-race.png",
      originalName: "mark-ready-race.png",
      contentType: "image/png",
      sizeBytes: 4,
    });
    let raced = false;
    const racingDatabase = {
      prepare: (...args: Parameters<D1Database["prepare"]>) => env.DB.prepare(...args),
      withSession: (...args: Parameters<D1Database["withSession"]>) => env.DB.withSession(...args),
      batch: async <T>(statements: D1PreparedStatement[]) => {
        if (!raced) {
          raced = true;
          await env.DB.prepare("UPDATE media_assets SET state = 'pending_delete' WHERE id = ?")
            .bind(asset.id).run();
        }
        return env.DB.batch<T>(statements);
      },
    } as D1Database;

    await expect(markMediaReady(racingDatabase, asset.id, post.id))
      .rejects.toBeInstanceOf(AdminConflictError);
    expect(await listPostAssets(env.DB, post.id)).toEqual([]);
    expect(await env.DB.prepare("SELECT state FROM media_assets WHERE id = ?")
      .bind(asset.id).first()).toEqual({ state: "pending_delete" });
  });

  it("adds cover and inline assets to the library union automatically", async () => {
    const post = await createTestPost("automatic-library-union");
    const cover = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/union-cover.png",
      originalName: "union-cover.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });
    const inline = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/union-inline.png",
      originalName: "union-inline.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });
    await markMediaReady(env.DB, cover.id);
    await markMediaReady(env.DB, inline.id);

    const assets = await syncPostAssetLinks(env.DB, post.id, {
      draftToken,
      retainedAssetIds: [],
      coverAssetId: cover.id,
      inlineKeys: [inline.key],
    });

    expect(assets.find(({ id }) => id === cover.id)?.usages).toEqual(["cover", "library"]);
    expect(assets.find(({ id }) => id === inline.id)?.usages).toEqual(["inline", "library"]);
  });

  it("rolls back link rebuilding when an asset changes after resolution", async () => {
    const post = await createTestPost("stale-sync-guard");
    const [current, replacement] = await insertReadyAssets(2, "stale-sync");
    await syncPostAssetLinks(env.DB, post.id, {
      retainedAssetIds: [current!.id],
      inlineKeys: [],
    });
    const input = { retainedAssetIds: [replacement!.id], inlineKeys: [] };
    const resolved = await resolvePostAssetSync(env.DB, input);
    await env.DB.prepare("UPDATE media_assets SET state = 'pending_delete' WHERE id = ?")
      .bind(replacement!.id).run();

    await expect(env.DB.batch(
      buildPostAssetSyncStatements(env.DB, post.id, resolved, new Date()),
    )).rejects.toThrow();
    expect((await listPostAssets(env.DB, post.id)).map(({ id }) => id)).toEqual([current!.id]);
  });

  it("rolls back link rebuilding when draft ownership changes after resolution", async () => {
    const post = await createTestPost("stale-draft-guard");
    const asset = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/stale-draft.png",
      originalName: "stale-draft.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });
    await markMediaReady(env.DB, asset.id);
    const resolved = await resolvePostAssetSync(env.DB, {
      draftToken,
      retainedAssetIds: [asset.id],
      inlineKeys: [],
    });
    await env.DB.prepare("UPDATE media_assets SET draft_token = ? WHERE id = ?")
      .bind("22222222-2222-4222-8222-222222222222", asset.id).run();

    await expect(env.DB.batch(
      buildPostAssetSyncStatements(env.DB, post.id, resolved, new Date()),
    )).rejects.toThrow();
    expect(await listPostAssets(env.DB, post.id)).toEqual([]);
  });

  it("maps a state race during sync to an administrator conflict", async () => {
    const post = await createTestPost("mapped-stale-sync");
    const [asset] = await insertReadyAssets(1, "mapped-stale-sync");
    let raced = false;
    const racingDatabase = {
      prepare: (...args: Parameters<D1Database["prepare"]>) => env.DB.prepare(...args),
      withSession: (...args: Parameters<D1Database["withSession"]>) => env.DB.withSession(...args),
      batch: async <T>(statements: D1PreparedStatement[]) => {
        if (!raced) {
          raced = true;
          await env.DB.prepare("UPDATE media_assets SET state = 'pending_delete' WHERE id = ?")
            .bind(asset!.id).run();
        }
        return env.DB.batch<T>(statements);
      },
    } as D1Database;

    await expect(syncPostAssetLinks(racingDatabase, post.id, {
      retainedAssetIds: [asset!.id],
      inlineKeys: [],
    })).rejects.toBeInstanceOf(AdminConflictError);
    expect(await listPostAssets(env.DB, post.id)).toEqual([]);
  });

  it("keeps a shared asset ready when one post removes its library link", async () => {
    const first = await createTestPost("shared-remove-first");
    const second = await createTestPost("shared-remove-second");
    const [asset] = await insertReadyAssets(1, "shared-remove");
    await syncPostAssetLinks(env.DB, first.id, {
      retainedAssetIds: [asset!.id],
      inlineKeys: [],
    });
    await syncPostAssetLinks(env.DB, second.id, {
      retainedAssetIds: [asset!.id],
      inlineKeys: [],
    });

    await removePostAsset(env.DB, first.id, asset!.id);

    expect(await listPostAssets(env.DB, first.id)).toEqual([]);
    expect((await listPostAssets(env.DB, second.id))[0]).toMatchObject({
      id: asset!.id,
      sharedBy: 0,
    });
    expect(await listMediaCleanupJobs(env.DB)).toEqual([]);
    expect(await env.DB.prepare("SELECT state FROM media_assets WHERE id = ?")
      .bind(asset!.id).first()).toEqual({ state: "ready" });
  });

  it("leaves an unlinked draft upload unchanged when removal returns not found", async () => {
    const post = await createTestPost("unlinked-remove");
    const asset = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/unlinked-remove.png",
      originalName: "unlinked-remove.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });

    await expect(removePostAsset(env.DB, post.id, asset.id))
      .rejects.toBeInstanceOf(AdminNotFoundError);
    expect(await env.DB.prepare(
      "SELECT state, draft_token FROM media_assets WHERE id = ?",
    ).bind(asset.id).first()).toEqual({
      state: "uploading",
      draft_token: draftToken,
    });
    expect(await listMediaCleanupJobs(env.DB)).toEqual([]);
  });

  it.each(["cover", "inline"] as const)(
    "keeps the library link and reports %s when that usage appears during removal",
    async (usage) => {
      const post = await createTestPost(`remove-${usage}-race-guard`);
      const [asset] = await insertReadyAssets(1, `remove-${usage}-race`);
      await syncPostAssetLinks(env.DB, post.id, {
        retainedAssetIds: [asset!.id],
        inlineKeys: [],
      });
      let raced = false;
      const racingDatabase = {
        prepare: (...args: Parameters<D1Database["prepare"]>) => env.DB.prepare(...args),
        withSession: (...args: Parameters<D1Database["withSession"]>) => env.DB.withSession(...args),
        batch: async <T>(statements: D1PreparedStatement[]) => {
          if (!raced) {
            raced = true;
            await env.DB.prepare(
              `INSERT INTO post_asset_links (post_id, asset_id, usage, sort_order, created_at)
               VALUES (?, ?, ?, 0, ?)`,
            ).bind(post.id, asset!.id, usage, new Date().toISOString()).run();
          }
          return env.DB.batch<T>(statements);
        },
      } as D1Database;

      await expect(removePostAsset(racingDatabase, post.id, asset!.id))
        .rejects.toMatchObject({
          name: "AdminConflictError",
          details: { usages: [usage] },
        });
      expect((await listPostAssets(env.DB, post.id))[0]?.usages).toEqual([usage, "library"]);
    },
  );

  it("keeps a 100-draft-asset sync within the D1 Free query budget", async () => {
    const post = await createTestPost("draft-batch-budget");
    const assets = await insertReadyAssets(100, "draft-batch-budget", draftToken);
    const resolved = await resolvePostAssetSync(env.DB, {
      draftToken,
      retainedAssetIds: assets.map(({ id }) => id),
      inlineKeys: assets.map(({ key }) => key),
    });
    const statements = buildPostAssetSyncStatements(env.DB, post.id, resolved, new Date());

    expect(statements).toHaveLength(12);
    expect(statements.length).toBeLessThanOrEqual(50);
    await env.DB.batch(statements);
    const linked = await listPostAssets(env.DB, post.id);
    expect(linked).toHaveLength(100);
    expect(linked.every(({ usages }) => usages.includes("inline"))).toBe(true);
    expect(await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM media_assets WHERE draft_token IS NOT NULL",
    ).first()).toEqual({ count: 0 });
  });

  it("chunks more than 100 retained assets within D1 binding limits", async () => {
    const post = await createTestPost("chunked-assets");
    const assets = await insertReadyAssets(101, "chunked-assets");

    const linked = await syncPostAssetLinks(env.DB, post.id, {
      retainedAssetIds: assets.map(({ id }) => id),
      coverAssetId: assets[0]!.id,
      inlineKeys: [assets.at(-1)!.key],
    });

    expect(linked).toHaveLength(101);
    expect(linked.find(({ id }) => id === assets[0]!.id)?.usages)
      .toEqual(["cover", "library"]);
    expect(linked.find(({ id }) => id === assets.at(-1)!.id)?.usages)
      .toEqual(["inline", "library"]);
  });
});
