import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  readAdminMedia,
  storeAdminMedia,
} from "../../src/lib/cloudflare/media";

describe("R2 administrator media", () => {
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
    const object = await env.MEDIA.get(stored.key);
    expect(object?.httpMetadata?.contentType).toBe(type);
    expect(object?.customMetadata?.originalName).toBe(`avatar.${extension}`);
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
