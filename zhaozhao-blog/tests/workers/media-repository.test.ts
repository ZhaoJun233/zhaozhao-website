import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  AdminConflictError,
  createPost,
} from "../../src/lib/database/admin-repository";
import {
  beginMediaUpload,
  buildPostAssetSyncStatements,
  completeMediaCleanup,
  failMediaCleanup,
  failMediaUpload,
  listMediaCleanupJobs,
  listPostAssets,
  markMediaReady,
  previewPostDelete,
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

  it("previews exclusive and shared assets without counting usages twice", async () => {
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
