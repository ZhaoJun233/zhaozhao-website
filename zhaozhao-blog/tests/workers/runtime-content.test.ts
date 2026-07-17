import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  loadRuntimeEditorial,
  loadRuntimePosts,
  loadRuntimeProfile,
  loadRuntimeProjects,
} from "../../src/lib/runtime-content";

describe("runtime content backed by D1", () => {
  it("loads request-time profile, categories, and friends", async () => {
    const stored = await env.DB.prepare(
      "SELECT value_json FROM site_settings WHERE key = 'profile'",
    ).first<{ value_json: string }>();
    const profileValue = JSON.parse(stored!.value_json) as { name: string };
    profileValue.name = "数据库里的233昭";
    await env.DB.batch([
      env.DB.prepare("UPDATE site_settings SET value_json = ? WHERE key = 'profile'")
        .bind(JSON.stringify(profileValue)),
      env.DB.prepare("UPDATE friends SET name = ? WHERE sort_order = 0").bind("数据库友链"),
    ]);

    const [profile, editorial] = await Promise.all([
      loadRuntimeProfile(),
      loadRuntimeEditorial(),
    ]);

    expect(profile.name).toBe("数据库里的233昭");
    expect(profile.avatarUrl).toMatch(/^\/media\/profile\/.+\/$/);
    expect(editorial.taxonomy.categories.map(({ name }) => name)).toEqual([
      "开发",
      "阅读",
      "生活",
    ]);
    expect(editorial.friends.links).toHaveLength(4);
    expect(editorial.friends.links[0]?.name).toBe("数据库友链");
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
