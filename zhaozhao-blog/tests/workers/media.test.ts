import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  readAdminMedia,
  storeAdminMedia,
} from "../../src/lib/cloudflare/media";
import {
  runMediaCleanup,
  uploadPostImage,
  type MediaObjectStore,
} from "../../src/lib/cloudflare/post-media";
import {
  listMediaCleanupJobs,
  queueDraftCleanup,
} from "../../src/lib/database/media-repository";

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
