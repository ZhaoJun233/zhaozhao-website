import { describe, expect, it } from "vitest";
import {
  categoryInputSchema,
  musicTrackInputSchema,
  postInputSchema,
  postMediaInputSchema,
  profileSettingSchema,
} from "../../src/lib/admin/schemas";
import { AdminConflictError } from "../../src/lib/database/admin-repository";

describe("administrator payload contracts", () => {
  it("applies stable defaults to category input", () => {
    expect(categoryInputSchema.parse({ name: " 新分类 " })).toEqual({
      name: "新分类",
      enabled: true,
    });
  });

  it("requires article covers and accessible descriptions together", () => {
    expect(() => postInputSchema.parse({
      slug: "cover-test",
      title: "封面测试",
      description: "验证封面字段。",
      body: "正文",
      publishedAt: "2026-07-17",
      category: "开发",
      tags: ["测试"],
      cover: "/media/cover.jpg",
    })).toThrow("封面与说明必须同时填写");
  });

  it("accepts numeric NetEase song ids and rejects copied song URLs", () => {
    expect(musicTrackInputSchema.parse({
      title: "夜晚的歌",
      artist: "歌手",
      neteaseSongId: "123456789",
      enabled: true,
    })).toMatchObject({ neteaseSongId: "123456789" });

    expect(() => musicTrackInputSchema.parse({
      title: "错误歌曲",
      artist: "歌手",
      neteaseSongId: "https://music.163.com/song?id=1",
      enabled: true,
    })).toThrow("网易云歌曲 ID 只能填写数字");
  });

  it("explains invalid canonical links and expired draft identifiers", () => {
    expect(() => postInputSchema.parse({
      slug: "url-test",
      title: "链接测试",
      description: "验证链接提示。",
      body: "正文",
      publishedAt: "2026-07-18",
      category: "开发",
      tags: ["测试"],
      canonicalUrl: "example.com/article",
    })).toThrow("链接必须以 http:// 或 https:// 开头");
    expect(() => postMediaInputSchema.parse({
      draftToken: "",
      retainedAssetIds: [],
    })).toThrow("草稿标识失效");
  });

  it("accepts the complete long-term profile shape", () => {
    expect(profileSettingSchema.parse({
      name: "233昭",
      siteTitle: "昭昭的小站",
      description: "站点描述",
      bio: "个人简介",
      avatar: "/media/profile/avatar.jpg",
      occupation: "独立开发者",
      location: "杭州",
      motto: "持续记录。",
      email: "hello@example.com",
      website: "https://example.com/",
    })).toMatchObject({ occupation: "独立开发者", location: "杭州" });
  });

  it("preserves structured conflict details for API responses", () => {
    const error = new AdminConflictError("该分类仍被文章使用。", { references: 3 });
    expect(error.details).toEqual({ references: 3 });
  });
});
