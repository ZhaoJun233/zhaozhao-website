import { describe, expect, it, vi } from "vitest";
import {
  fetchNeteaseSongMetadata,
  isAllowedNeteaseCoverUrl,
} from "../../src/lib/netease-metadata";

describe("NetEase song metadata", () => {
  it("allows only HTTPS music.126.net cover hosts", () => {
    expect(isAllowedNeteaseCoverUrl("https://p1.music.126.net/cover.jpg")).toBe(true);
    expect(isAllowedNeteaseCoverUrl("https://music.126.net/cover.jpg")).toBe(true);
    expect(isAllowedNeteaseCoverUrl("http://p1.music.126.net/cover.jpg")).toBe(false);
    expect(isAllowedNeteaseCoverUrl("https://music.126.net.evil.example/cover.jpg")).toBe(false);
  });

  it("parses title, artists, and cover from the fixed song detail endpoint", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => Response.json({
      songs: [{
        name: "海阔天空",
        artists: [{ name: "Beyond" }, { name: "黄家驹" }],
        album: { picUrl: "https://p1.music.126.net/cover.jpg" },
      }],
    }));

    await expect(fetchNeteaseSongMetadata("347230", fetcher as typeof fetch))
      .resolves.toEqual({
        title: "海阔天空",
        artist: "Beyond / 黄家驹",
        coverSourceUrl: "https://p1.music.126.net/cover.jpg",
      });

    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.origin).toBe("https://music.163.com");
    expect(url.pathname).toBe("/api/song/detail");
    expect(url.searchParams.get("ids")).toBe("[\"347230\"]");
  });
});
