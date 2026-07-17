import { describe, expect, it } from "vitest";
import { artwork } from "../../src/data/artwork";
import {
  aboutContent,
  creditsContent,
  friendsContent,
  guestbookContent,
  homepageContent,
  navigationContent,
  pageCopy,
} from "../../src/data/content";
import taxonomy from "../../src/data/taxonomy.json";

describe("site data", () => {
  it("records the selected Bilibili source exactly", () => {
    expect(artwork.aboutSummerDream.bvid).toBe("BV1NCjx6oEhj");
    expect(artwork.aboutSummerDream.sourceUrl).toBe(
      "https://www.bilibili.com/video/BV1NCjx6oEhj/",
    );
    expect(artwork.aboutSummerDream.uploader).toBe("清水未萌_Minamo");
    expect(artwork.aboutSummerDream.alt).toBe("粉紫色海边的白发少女插画");
    expect(artwork.aboutSummerDream.placements).toEqual([
      "home-intro",
      "about-hero",
    ]);
  });

  it("ships the specified demonstration data counts", () => {
    expect(friendsContent.links).toHaveLength(4);
    expect(aboutContent.timeline.entries).toHaveLength(4);
  });

  it("keeps every friend link visibly fictional", () => {
    expect(friendsContent.notice).toContain("演示数据");

    for (const friend of friendsContent.links) {
      expect(new URL(friend.url).hostname.endsWith(".example")).toBe(true);
    }
  });

  it("records the real development milestones beginning on 2026-07-15", () => {
    expect(aboutContent.timeline.entries.map((entry) => entry.date)).toEqual([
      "2026-07-15",
      "2026-07-15",
      "2026-07-16",
      "2026-07-16",
    ]);
    expect(aboutContent.timeline.entries.map((entry) => entry.title)).toEqual([
      "开始搭建个人博客",
      "确定二次元视觉方向",
      "接入内容管理后台",
      "开放友链与数据库留言",
    ]);
  });

  it("validates every CMS-managed editorial area", () => {
    expect(navigationContent.items[0]).toEqual({ label: "首页", href: "/" });
    expect(homepageContent.hero.typingPhrases.length).toBeGreaterThan(0);
    expect(guestbookContent.guidelines.items.length).toBeGreaterThan(0);
    expect(pageCopy.categories.heading).not.toBe("");
    expect(creditsContent.libraries.items.length).toBeGreaterThan(0);
  });

  it("keeps CMS-managed categories named, described, and unique", () => {
    const names = taxonomy.categories.map(({ name }) => name.trim());

    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => name.length > 0)).toBe(true);
    expect(new Set(names).size).toBe(names.length);
    expect(taxonomy.categories.every(({ description }) => description.trim().length > 0))
      .toBe(true);
  });
});
