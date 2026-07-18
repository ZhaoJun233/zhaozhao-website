import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:workers";
import { ADMIN_SESSION_COOKIE, createAdminSession } from "../../src/lib/admin/auth";
import {
  importNeteaseSongMetadata,
  type MetadataCache,
} from "../../src/lib/netease-metadata";
import { runMediaCleanup } from "../../src/lib/cloudflare/post-media";
import { queueDraftCleanup } from "../../src/lib/database/media-repository";

const draftToken = "11111111-1111-4111-8111-111111111111";

class MemoryMetadataCache implements MetadataCache {
  private readonly values = new Map<string, Response>();

  async match(request: Request): Promise<Response | undefined> {
    return this.values.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.values.set(request.url, response.clone());
  }
}

function songDetail(options?: { cover?: string; artists?: string[] }) {
  return Response.json({
    songs: [{
      name: "海阔天空",
      artists: (options?.artists ?? ["Beyond"]).map((name) => ({ name })),
      album: { picUrl: options?.cover ?? "https://p1.music.126.net/cover.jpg" },
    }],
  });
}

function metadataFetcher(options?: { cover?: string; coverStatus?: number }) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.origin === "https://music.163.com") {
      return songDetail({ cover: options?.cover });
    }
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: options?.coverStatus ?? 200,
      headers: { "content-type": "image/jpeg" },
    });
  });
}

describe("NetEase managed metadata", () => {
  it("imports a managed cover into the existing draft media lifecycle", async () => {
    const result = await importNeteaseSongMetadata({
      database: env.DB,
      store: env.MEDIA,
      input: { neteaseSongId: "347230", draftToken },
      fetcher: metadataFetcher() as typeof fetch,
      cache: new MemoryMetadataCache(),
    });

    expect(result).toMatchObject({
      title: "海阔天空",
      artist: "Beyond",
      coverAssetId: expect.any(String),
      coverUrl: expect.stringMatching(/^\/media\/uploads\//),
      warning: undefined,
    });
    const stored = await env.DB.prepare("SELECT kv_key FROM media_assets WHERE id = ?")
      .bind(result.coverAssetId)
      .first<{ kv_key: string }>();
    expect(await env.MEDIA.get(stored!.kv_key, "arrayBuffer")).not.toBeNull();
  });

  it("reuses cached song metadata for 24 hours", async () => {
    const fetcher = metadataFetcher();
    const cache = new MemoryMetadataCache();
    await importNeteaseSongMetadata({
      database: env.DB,
      store: env.MEDIA,
      input: { neteaseSongId: "347230", draftToken },
      fetcher: fetcher as typeof fetch,
      cache,
    });
    await importNeteaseSongMetadata({
      database: env.DB,
      store: env.MEDIA,
      input: {
        neteaseSongId: "347230",
        draftToken: "22222222-2222-4222-8222-222222222222",
      },
      fetcher: fetcher as typeof fetch,
      cache,
    });

    const detailFetches = fetcher.mock.calls.filter(([input]) =>
      new URL(String(input)).origin === "https://music.163.com"
    );
    expect(detailFetches).toHaveLength(1);
  });

  it("rejects a missing song without creating media", async () => {
    const fetcher = vi.fn(async () => Response.json({ songs: [] }));

    await expect(importNeteaseSongMetadata({
      database: env.DB,
      store: env.MEDIA,
      input: { neteaseSongId: "404", draftToken },
      fetcher: fetcher as typeof fetch,
      cache: new MemoryMetadataCache(),
    })).rejects.toThrow("未找到网易云歌曲");
    expect(await env.DB.prepare("SELECT id FROM media_assets").all()).toMatchObject({ results: [] });
  });

  it("keeps metadata usable when the cover host is not allowed", async () => {
    const fetcher = metadataFetcher({ cover: "https://evil.example/cover.jpg" });
    const result = await importNeteaseSongMetadata({
      database: env.DB,
      store: env.MEDIA,
      input: { neteaseSongId: "347230", draftToken },
      fetcher: fetcher as typeof fetch,
      cache: new MemoryMetadataCache(),
    });

    expect(result).toEqual({
      title: "海阔天空",
      artist: "Beyond",
      warning: "歌曲信息已获取，封面请手动上传。",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns title and artist when the cover download fails", async () => {
    const result = await importNeteaseSongMetadata({
      database: env.DB,
      store: env.MEDIA,
      input: { neteaseSongId: "347230", draftToken },
      fetcher: metadataFetcher({ coverStatus: 502 }) as typeof fetch,
      cache: new MemoryMetadataCache(),
    });

    expect(result).toEqual({
      title: "海阔天空",
      artist: "Beyond",
      warning: "歌曲信息已获取，封面请手动上传。",
    });
  });

  it("removes an automatically imported cover when its draft is cancelled", async () => {
    const result = await importNeteaseSongMetadata({
      database: env.DB,
      store: env.MEDIA,
      input: { neteaseSongId: "347230", draftToken },
      fetcher: metadataFetcher() as typeof fetch,
      cache: new MemoryMetadataCache(),
    });
    const stored = await env.DB.prepare("SELECT kv_key FROM media_assets WHERE id = ?")
      .bind(result.coverAssetId)
      .first<{ kv_key: string }>();

    await queueDraftCleanup(env.DB, draftToken, "draft_cancelled");
    await runMediaCleanup(env.DB, env.MEDIA);

    expect(await env.MEDIA.get(stored!.kv_key, "arrayBuffer")).toBeNull();
    expect(await env.DB.prepare("SELECT id FROM media_assets WHERE id = ?")
      .bind(result.coverAssetId).first()).toBeNull();
  });

  it("requires an authenticated administrator for the metadata endpoint", async () => {
    const { createMusicMetadataRoute } = await import(
      "../../src/pages/api/admin/music/metadata"
    );
    const body = JSON.stringify({ neteaseSongId: "347230", draftToken });
    const unauthorized = await createMusicMetadataRoute({
      fetcher: metadataFetcher() as typeof fetch,
      cache: new MemoryMetadataCache(),
      store: env.MEDIA,
    })({
      request: new Request("https://example.test/api/admin/music/metadata/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      }),
    } as never);
    expect(unauthorized.status).toBe(401);

    const session = await createAdminSession(env.DB, undefined, undefined, env.ADMIN_SESSION_SECRET);
    const authorized = await createMusicMetadataRoute({
      fetcher: metadataFetcher() as typeof fetch,
      cache: new MemoryMetadataCache(),
      store: env.MEDIA,
    })({
      request: new Request("https://example.test/api/admin/music/metadata/", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${ADMIN_SESSION_COOKIE}=${session.token}`,
        },
        body,
      }),
    } as never);
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toMatchObject({
      data: { title: "海阔天空", artist: "Beyond", coverAssetId: expect.any(String) },
    });
  });
});
