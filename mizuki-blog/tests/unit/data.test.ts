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

  it("covers the four specified blog milestones", () => {
    expect(aboutContent.timeline.entries.map((entry) => entry.title)).toEqual([
      "创建这间网络小屋",
      "开始记录动画随记",
      "发布第一篇开发笔记",
      "打开留言簿",
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
