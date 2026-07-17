import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  AdminConflictError,
  createPost,
} from "../../src/lib/database/admin-repository";
import {
  beginMediaUpload,
  completeMediaCleanup,
  failMediaCleanup,
  failMediaUpload,
  listMediaCleanupJobs,
  listPostAssets,
  markMediaReady,
  previewPostDelete,
  queueDraftCleanup,
  removePostAsset,
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
});
