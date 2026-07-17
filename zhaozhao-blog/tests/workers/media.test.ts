import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  readAdminMedia,
  storeAdminMedia,
} from "../../src/lib/cloudflare/media";
import {
  MediaUploadRecoveryError,
  runMediaCleanup,
  uploadPostImage,
  type MediaObjectStore,
} from "../../src/lib/cloudflare/post-media";
import { createPost } from "../../src/lib/database/admin-repository";
import {
  beginMediaUpload,
  failMediaUpload,
  listMediaCleanupJobs,
  queueDraftCleanup,
} from "../../src/lib/database/media-repository";

async function createTestPost(slug: string) {
  return createPost(env.DB, {
    slug,
    title: slug,
    description: "Media service test post.",
    body: "Test body.",
    publishedAt: "2026-07-17T00:00:00.000Z",
    draft: true,
    category: "开发",
    tags: ["test"],
    featured: false,
  });
}

function databaseWithFailedBatchCalls(...failedCalls: number[]): D1Database {
  let calls = 0;
  return {
    prepare: env.DB.prepare.bind(env.DB),
    batch: async <T = unknown>(statements: D1PreparedStatement[]) => {
      calls += 1;
      if (failedCalls.includes(calls)) throw new Error("cleanup queue unavailable");
      return env.DB.batch<T>(statements);
    },
    exec: env.DB.exec.bind(env.DB),
    withSession: env.DB.withSession.bind(env.DB),
  };
}

describe("KV administrator media", () => {
  it("uploads a draft article image and returns its asset", async () => {
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], "hero.png", {
      type: "image/png",
    });

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
  });

  it("attaches a post upload to the article library immediately", async () => {
    const post = await createTestPost("direct-post-upload");
    const asset = await uploadPostImage(
      env.DB,
      env.MEDIA,
      new File(["image"], "post.png", { type: "image/png" }),
      { postId: post.id },
    );

    expect(asset.usages).toEqual(["library"]);
    expect(asset.sharedBy).toBe(0);
    expect(await env.MEDIA.get(asset.key, "arrayBuffer")).not.toBeNull();
  });

  it("discards only the uploading row when the object write fails", async () => {
    let deleteCalls = 0;
    const store: MediaObjectStore = {
      put: async () => {
        throw new Error("KV put failed");
      },
      delete: async () => {
        deleteCalls += 1;
      },
    };

    await expect(uploadPostImage(
      env.DB,
      store,
      new File(["image"], "put-failure.png", { type: "image/png" }),
      { draftToken: "44444444-4444-4444-8444-444444444444" },
    )).rejects.toThrow("KV put failed");

    expect(deleteCalls).toBe(0);
    expect(await env.DB.prepare("SELECT id FROM media_assets").all()).toMatchObject({
      results: [],
    });
    expect(await listMediaCleanupJobs(env.DB)).toEqual([]);
  });

  it("cleans the object when the ready state cannot be persisted", async () => {
    const post = await createTestPost("ready-state-failure");
    let key = "";
    const store: MediaObjectStore = {
      put: async (nextKey, value, options) => {
        key = nextKey;
        await env.MEDIA.put(nextKey, value, options);
      },
      delete: (nextKey) => env.MEDIA.delete(nextKey),
    };

    await expect(uploadPostImage(
      databaseWithFailedBatchCalls(1),
      store,
      new File(["image"], "missing-post.png", { type: "image/png" }),
      { postId: post.id },
    )).rejects.toThrow();

    expect(key).toMatch(/^uploads\//);
    expect(await env.MEDIA.get(key, "arrayBuffer")).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM media_assets WHERE kv_key = ?")
      .bind(key).first()).toBeNull();
    expect(await listMediaCleanupJobs(env.DB)).toEqual([]);
  });

  it("reports cleanup queue failure after removing the untracked object", async () => {
    const post = await createTestPost("cleanup-queue-failure");
    let key = "";
    const store: MediaObjectStore = {
      put: async (nextKey, value, options) => {
        key = nextKey;
        await env.MEDIA.put(nextKey, value, options);
      },
      delete: (nextKey) => env.MEDIA.delete(nextKey),
    };
    const database = databaseWithFailedBatchCalls(1, 2);

    const error = await uploadPostImage(
      database,
      store,
      new File(["image"], "queue-failure.png", { type: "image/png" }),
      { postId: post.id },
    ).catch((uploadError: unknown) => uploadError);

    expect(error).toMatchObject({
      name: "MediaUploadRecoveryError",
      message: expect.stringContaining("清理任务"),
    });
    expect(error).toBeInstanceOf(MediaUploadRecoveryError);
    const recoveryError = error as MediaUploadRecoveryError;
    expect(recoveryError).toMatchObject({
      cleanupQueued: false,
      objectDeleted: true,
      queueError: expect.objectContaining({ message: "cleanup queue unavailable" }),
    });
    expect(recoveryError.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: "cleanup queue unavailable" }),
    ]));
    expect(recoveryError.message).toContain(recoveryError.assetId);
    expect(recoveryError.message).toContain(recoveryError.key);
    expect(await env.MEDIA.get(key, "arrayBuffer")).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM media_assets WHERE kv_key = ?")
      .bind(key).first()).toBeNull();
    expect(await listMediaCleanupJobs(env.DB)).toEqual([]);
  });

  it("reports an actionable recovery contract when queueing and deletion fail", async () => {
    const post = await createTestPost("cleanup-queue-delete-failure");
    let key = "";
    const store: MediaObjectStore = {
      put: async (nextKey, value, options) => {
        key = nextKey;
        await env.MEDIA.put(nextKey, value, options);
      },
      delete: async () => {
        throw new Error("KV delete unavailable");
      },
    };
    const database = databaseWithFailedBatchCalls(1, 2);

    const error = await uploadPostImage(
      database,
      store,
      new File(["image"], "double-failure.png", { type: "image/png" }),
      { postId: post.id },
    ).catch((uploadError: unknown) => uploadError);

    expect(error).toBeInstanceOf(MediaUploadRecoveryError);
    const recoveryError = error as MediaUploadRecoveryError;
    expect(recoveryError).toMatchObject({
      key,
      cleanupQueued: false,
      objectDeleted: false,
      cause: expect.any(Error),
      queueError: expect.objectContaining({ message: "cleanup queue unavailable" }),
      deleteError: expect.objectContaining({ message: "KV delete unavailable" }),
    });
    expect(recoveryError.message).toContain(recoveryError.assetId);
    expect(recoveryError.message).toContain(key);
    expect(await env.DB.prepare("SELECT state FROM media_assets WHERE id = ?")
      .bind(recoveryError.assetId).first()).toEqual({ state: "uploading" });
    expect(await listMediaCleanupJobs(env.DB)).toEqual([]);
    expect(await env.MEDIA.get(key, "arrayBuffer")).not.toBeNull();
  });

  it("retries cleanup after an object deletion fails", async () => {
    const draftToken = "33333333-3333-4333-8333-333333333333";
    const asset = await uploadPostImage(
      env.DB,
      env.MEDIA,
      new File(["image"], "cleanup.png", { type: "image/png" }),
      { draftToken },
    );
    await queueDraftCleanup(env.DB, draftToken, "draft_cancelled");

    let shouldFail = true;
    const store: MediaObjectStore = {
      put: (key, value, options) => env.MEDIA.put(key, value, options),
      delete: async (key) => {
        if (shouldFail) {
          shouldFail = false;
          throw new Error("temporary KV failure");
        }
        await env.MEDIA.delete(key);
      },
    };

    await expect(runMediaCleanup(env.DB, store)).resolves.toEqual({
      completed: 0,
      failed: 1,
    });
    expect(await listMediaCleanupJobs(env.DB)).toMatchObject([
      { asset_id: asset.id, attempts: 1, last_error: "temporary KV failure" },
    ]);

    await expect(runMediaCleanup(env.DB, store)).resolves.toEqual({
      completed: 1,
      failed: 0,
    });
    expect(await listMediaCleanupJobs(env.DB)).toEqual([]);
    expect(await env.MEDIA.get(asset.key, "arrayBuffer")).toBeNull();
  });

  it("completes cleanup when the object is already absent", async () => {
    const asset = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/already-absent.png",
      originalName: "already-absent.png",
      contentType: "image/png",
      sizeBytes: 5,
    });
    await failMediaUpload(env.DB, asset.id);

    await expect(runMediaCleanup(env.DB, env.MEDIA)).resolves.toEqual({
      completed: 1,
      failed: 0,
    });
    expect(await listMediaCleanupJobs(env.DB)).toEqual([]);
    expect(await env.DB.prepare("SELECT id FROM media_assets WHERE id = ?")
      .bind(asset.id).first()).toBeNull();
  });

  it.each([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
  ])("stores %s uploads with metadata", async (type, extension) => {
    const file = new File([new Uint8Array([1, 2, 3, 4])], `avatar.${extension}`, { type });
    const stored = await storeAdminMedia(env.MEDIA, file, new Date("2026-07-17T08:00:00Z"));

    expect(stored.key).toMatch(new RegExp(`^uploads/2026/07/[0-9a-f-]+\\.${extension}$`));
    expect(stored.url).toBe(`/media/${stored.key}`);
    const object = await env.MEDIA.getWithMetadata<{
      contentType: string;
      originalName: string;
    }>(stored.key, "arrayBuffer");
    expect(object.metadata?.contentType).toBe(type);
    expect(object.metadata?.originalName).toBe(`avatar.${extension}`);
  });

  it("rejects unsupported and oversized files", async () => {
    await expect(storeAdminMedia(
      env.MEDIA,
      new File(["text"], "notes.txt", { type: "text/plain" }),
    )).rejects.toThrow("JPEG、PNG、WebP 或 GIF");

    await expect(storeAdminMedia(
      env.MEDIA,
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
    )).rejects.toThrow("5 MiB");
  });

  it("returns uploaded objects with immutable cache headers", async () => {
    const stored = await storeAdminMedia(
      env.MEDIA,
      new File(["image"], "hero.png", { type: "image/png" }),
    );
    const response = await readAdminMedia(env.MEDIA, stored.key);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("etag")).toBeTruthy();
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe("image");
    expect((await readAdminMedia(env.MEDIA, "backgrounds/home-hero.png")).status).toBe(404);
    expect((await readAdminMedia(env.MEDIA, "uploads/missing.png")).status).toBe(404);
  });
});
