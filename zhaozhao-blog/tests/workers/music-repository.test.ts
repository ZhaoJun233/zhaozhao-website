import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  createMusicTrack,
  deleteMusicTrack,
  listEnabledMusicTracks,
  listMusicTracks,
  orderMusicTracks,
  updateMusicTrack,
} from "../../src/lib/database/music-repository";

describe("music track repository", () => {
  it("creates, filters, updates, orders, and deletes tracks", async () => {
    const first = await createMusicTrack(env.DB, {
      title: "第一首歌",
      artist: "歌手 A",
      neteaseSongId: "101",
      enabled: true,
    });
    const second = await createMusicTrack(env.DB, {
      title: "第二首歌",
      artist: "歌手 B",
      neteaseSongId: "202",
      enabled: false,
    });

    expect(await listEnabledMusicTracks(env.DB)).toEqual([
      expect.objectContaining({ id: first.id, neteaseSongId: "101" }),
    ]);
    expect(first.embedUrl).toContain("music.163.com/outchain/player");
    expect(first.neteaseUrl).toBe("https://music.163.com/#/song?id=101");

    await expect(createMusicTrack(env.DB, {
      title: "重复",
      artist: "歌手 C",
      neteaseSongId: "101",
      enabled: true,
    })).rejects.toThrow("该网易云歌曲已经存在");

    await updateMusicTrack(env.DB, second.id, {
      title: "第二首歌（更新）",
      artist: "歌手 B",
      neteaseSongId: "202",
      note: "适合夜晚。",
      enabled: true,
    });
    await orderMusicTracks(env.DB, [second.id, first.id]);
    expect((await listMusicTracks(env.DB)).map(({ id }) => id)).toEqual([second.id, first.id]);

    await deleteMusicTrack(env.DB, first.id);
    expect((await listMusicTracks(env.DB)).map(({ id }) => id)).toEqual([second.id]);
  });
});
