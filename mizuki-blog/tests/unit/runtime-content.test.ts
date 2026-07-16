import { describe, expect, it } from "vitest";
import {
  loadRuntimeEditorial,
  loadRuntimePosts,
  loadRuntimeProfile,
  loadRuntimeProjects,
} from "../../src/lib/runtime-content";

describe("runtime content repository", () => {
  it("loads CMS-managed profile, categories, and friends from disk", async () => {
    const [profile, editorial] = await Promise.all([
      loadRuntimeProfile(),
      loadRuntimeEditorial(),
    ]);

    expect(profile.name).toBe("233昭");
    expect(profile.avatarUrl).toMatch(/^\/media\/profile\/.+\/$/);
    expect(editorial.taxonomy.categories.map(({ name }) => name)).toEqual([
      "开发",
      "阅读",
      "生活",
    ]);
    expect(editorial.friends.links).toHaveLength(4);
  });

  it("parses posts and projects at request time", async () => {
    const [posts, projects] = await Promise.all([loadRuntimePosts(), loadRuntimeProjects()]);
    const post = posts.find(({ id }) => id === "astro-content-collections");

    expect(posts).toHaveLength(6);
    expect(projects).toHaveLength(3);
    expect(post?.data.publishedAt).toBeInstanceOf(Date);
    expect(post?.html).toContain("<h2 id=");
    expect(post?.headings.length).toBeGreaterThan(0);
  });
});
