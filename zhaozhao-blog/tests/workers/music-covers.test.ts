import { describe, expect, it, vi } from "vitest";
import { createMusicCoversRoute } from "../../src/pages/api/music/covers";

describe("public music covers API", () => {
  it("returns stored covers and safely resolved NetEase covers", async () => {
    const metadataForSong = vi.fn(async (songId: string) => ({
      title: `Song ${songId}`,
      artist: "Artist",
      coverSourceUrl: songId === "2"
        ? "https://p1.music.126.net/album.jpg"
        : "https://example.com/not-allowed.jpg",
    }));
    const route = createMusicCoversRoute({
      listTracks: async () => [
        { id: "stored", neteaseSongId: "1", coverUrl: "/media/uploads/stored.jpg/" },
        { id: "remote", neteaseSongId: "2" },
        { id: "unsafe", neteaseSongId: "3" },
      ],
      metadataForSong,
    });

    const response = await route({
      request: new Request("https://blog.example/api/music/covers/"),
    } as never);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400");
    expect(await response.json()).toEqual({
      data: {
        stored: "/media/uploads/stored.jpg/",
        remote: "https://p1.music.126.net/album.jpg",
      },
    });
    expect(metadataForSong).toHaveBeenCalledTimes(2);
  });

  it("keeps the endpoint available when NetEase metadata fails", async () => {
    const route = createMusicCoversRoute({
      listTracks: async () => [{ id: "missing", neteaseSongId: "4" }],
      metadataForSong: vi.fn(async () => {
        throw new Error("upstream unavailable");
      }),
    });

    const response = await route({
      request: new Request("https://blog.example/api/music/covers/"),
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: {} });
  });
});
