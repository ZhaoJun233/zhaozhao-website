import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  readCategories,
  readFriendPage,
  readFriends,
  readPosts,
  readProjects,
  readSetting,
} from "../../src/lib/database/content-repository";

describe("D1 content repository", () => {
  it("reads seeded settings and public collections", async () => {
    const [profile, friendPage, categories, friends, posts, projects] = await Promise.all([
      readSetting<{ name: string }>(env.DB, "profile"),
      readFriendPage<{ hero: { title: string } }>(env.DB),
      readCategories(env.DB),
      readFriends(env.DB),
      readPosts(env.DB),
      readProjects(env.DB),
    ]);

    expect(profile.name).toBe("233昭");
    expect(friendPage.hero.title).toContain("小站");
    expect(categories.map(({ name }) => name)).toEqual(["开发", "阅读", "生活"]);
    expect(friends).toHaveLength(4);
    expect(posts).toHaveLength(6);
    expect(projects).toHaveLength(3);
  });

  it("rejects a missing site setting explicitly", async () => {
    await expect(readSetting(env.DB, "missing-setting")).rejects.toThrow(
      "Missing site setting: missing-setting",
    );
  });
});
