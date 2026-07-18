import { describe, expect, it, vi } from "vitest";
import { createMusicAudioRoute } from "../../src/pages/api/music/audio/[id]";

describe("public music audio API", () => {
  it("redirects an enabled NetEase track to its HTTPS audio CDN URL", async () => {
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: {
        location: "http://m10.music.126.net/signed/song.mp3?token=temporary",
      },
    }));
    const route = createMusicAudioRoute({
      listTracks: async () => [{ id: "track-1", neteaseSongId: "543615420" }],
      fetcher,
    });

    const response = await route({
      params: { id: "track-1" },
      request: new Request("https://blog.example/api/music/audio/track-1/"),
    } as never);

    expect(fetcher).toHaveBeenCalledWith(
      "https://music.163.com/song/media/outer/url?id=543615420.mp3",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location"))
      .toBe("https://m10.music.126.net/signed/song.mp3?token=temporary");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects missing tracks and never forwards unsafe upstream redirects", async () => {
    const missing = createMusicAudioRoute({ listTracks: async () => [] });
    const missingResponse = await missing({
      params: { id: "missing" },
      request: new Request("https://blog.example/api/music/audio/missing/"),
    } as never);
    expect(missingResponse.status).toBe(404);

    const unsafe = createMusicAudioRoute({
      listTracks: async () => [{ id: "track-1", neteaseSongId: "543615420" }],
      fetcher: vi.fn(async () => new Response(null, {
        status: 302,
        headers: { location: "https://example.com/not-music.mp3" },
      })),
    });
    const unsafeResponse = await unsafe({
      params: { id: "track-1" },
      request: new Request("https://blog.example/api/music/audio/track-1/"),
    } as never);
    expect(unsafeResponse.status).toBe(302);
    expect(unsafeResponse.headers.get("location"))
      .toBe("https://music.163.com/song/media/outer/url?id=543615420.mp3");
  });
});
