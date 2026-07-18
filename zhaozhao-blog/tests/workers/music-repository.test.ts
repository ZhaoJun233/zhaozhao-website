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
import {
  beginMediaUpload,
  listMediaCleanupJobs,
  markMediaReady,
} from "../../src/lib/database/media-repository";

const draftToken = "11111111-1111-4111-8111-111111111111";

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

  it("links draft covers and only queues an unshared final reference", async () => {
    const firstCover = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/music-cover-one.png",
      originalName: "music-cover-one.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });
    await markMediaReady(env.DB, firstCover.id);

    const wrongDraftCover = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/music-cover-wrong.png",
      originalName: "music-cover-wrong.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });
    await markMediaReady(env.DB, wrongDraftCover.id);
    await expect(createMusicTrack(env.DB, {
      title: "错误归属",
      artist: "歌手",
      neteaseSongId: "300",
      enabled: true,
      draftToken: "22222222-2222-4222-8222-222222222222",
      coverAssetId: wrongDraftCover.id,
    })).rejects.toThrow("临时图片不属于当前编辑会话");

    const first = await createMusicTrack(env.DB, {
      title: "共享封面一",
      artist: "歌手",
      neteaseSongId: "301",
      enabled: true,
      draftToken,
      coverAssetId: firstCover.id,
    });
    expect(first.coverUrl).toBe("/media/uploads/2026/07/music-cover-one.png/");
    expect((await env.DB.prepare(
      "SELECT draft_token FROM media_assets WHERE id = ?",
    ).bind(firstCover.id).first<{ draft_token: string | null }>())?.draft_token).toBeNull();

    const second = await createMusicTrack(env.DB, {
      title: "共享封面二",
      artist: "歌手",
      neteaseSongId: "302",
      enabled: true,
      coverAssetId: firstCover.id,
    });
    await deleteMusicTrack(env.DB, first.id);
    expect(await listMediaCleanupJobs(env.DB)).toHaveLength(0);

    await deleteMusicTrack(env.DB, second.id);
    expect(await listMediaCleanupJobs(env.DB)).toContainEqual(expect.objectContaining({
      asset_id: firstCover.id,
      kv_key: "uploads/2026/07/music-cover-one.png",
      reason: "manual_remove",
    }));
  });
});
