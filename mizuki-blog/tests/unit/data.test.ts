import { describe, expect, it } from "vitest";
import { artwork } from "../../src/data/artwork";
import { friends, friendsNotice } from "../../src/data/friends";
import { timeline } from "../../src/data/timeline";

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
    expect(friends).toHaveLength(4);
    expect(timeline).toHaveLength(4);
  });

  it("keeps every friend link visibly fictional", () => {
    expect(friendsNotice).toContain("演示数据");

    for (const friend of friends) {
      expect(new URL(friend.url).hostname.endsWith(".example")).toBe(true);
    }
  });

  it("covers the four specified blog milestones", () => {
    expect(timeline.map((entry) => entry.title)).toEqual([
      "创建这间网络小屋",
      "开始记录动画随记",
      "发布第一篇开发笔记",
      "打开留言簿",
    ]);
  });
});
