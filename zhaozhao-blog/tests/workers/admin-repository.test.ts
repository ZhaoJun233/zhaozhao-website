import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  AdminConflictError,
  createCategory,
  createFriend,
  createPost,
  createProject,
  deleteCategory,
  deleteFriend,
  deletePost,
  deleteProject,
  exportBlogData,
  getAdminOverview,
  importBlogData,
  listCategories,
  listFriends,
  listPosts,
  listProjects,
  orderFriends,
  updateCategory,
  updateFriend,
  updateSetting,
} from "../../src/lib/database/admin-repository";

describe("D1 administrator repository", () => {
  it("renames categories across posts and protects referenced categories", async () => {
    const category = (await listCategories(env.DB)).find(({ name }) => name === "开发")!;
    const renamed = await updateCategory(env.DB, category.id, {
      name: "工程",
      description: category.description,
      enabled: true,
    });

    expect(renamed.slug).toBe("工程");
    expect((await listPosts(env.DB)).filter(({ category }) => category === "工程")).not.toHaveLength(0);
    await expect(deleteCategory(env.DB, category.id)).rejects.toBeInstanceOf(AdminConflictError);

    const unused = await createCategory(env.DB, { name: "随想", enabled: false });
    await deleteCategory(env.DB, unused.id);
    expect((await listCategories(env.DB)).some(({ id }) => id === unused.id)).toBe(false);
  });

  it("creates, edits, orders, disables, and deletes friends", async () => {
    const created = await createFriend(env.DB, {
      name: "测试友链",
      url: "https://friend.example/",
      description: "用于验证数据库后台。",
      interests: ["测试", "博客"],
      enabled: true,
    });
    const updated = await updateFriend(env.DB, created.id, {
      ...created,
      name: "已修改友链",
      enabled: false,
    });
    expect(updated.enabled).toBe(false);

    const ids = (await listFriends(env.DB)).map(({ id }) => id).reverse();
    expect((await orderFriends(env.DB, ids)).map(({ id }) => id)).toEqual(ids);
    await deleteFriend(env.DB, created.id);
    expect(await listFriends(env.DB)).toHaveLength(4);
  });

  it("creates and deletes posts and projects", async () => {
    const post = await createPost(env.DB, {
      slug: "imported-markdown-post",
      title: "导入的 Markdown 文章",
      description: "后台导入测试。",
      body: "## 正文\n\n测试内容。",
      publishedAt: "2026-07-17T00:00:00.000Z",
      draft: true,
      category: "开发",
      tags: ["Astro"],
      featured: false,
    });
    const project = await createProject(env.DB, {
      slug: "cloudflare-migration",
      title: "Cloudflare 迁移",
      description: "D1 CRUD 测试。",
      body: "迁移记录。",
      date: "2026-07-17T00:00:00.000Z",
      status: "active",
      tags: ["Cloudflare"],
      featured: true,
    });

    expect((await listPosts(env.DB)).some(({ id }) => id === post.id)).toBe(true);
    expect((await listProjects(env.DB)).some(({ id }) => id === project.id)).toBe(true);
    await deletePost(env.DB, post.id);
    await deleteProject(env.DB, project.id);
    expect(await getAdminOverview(env.DB)).toMatchObject({ posts: 6, projects: 3 });
  });

  it("updates settings and round-trips the complete JSON backup", async () => {
    const backup = await exportBlogData(env.DB);
    const originalFriendNames = backup.friends.map(({ name }) => name);
    const friend = backup.friends[0]!;
    await updateFriend(env.DB, friend.id, { ...friend, name: "临时修改" });
    await updateSetting(env.DB, "profile", {
      ...(backup.settings.profile as Record<string, unknown>),
      name: "数据库博主",
    });

    await importBlogData(env.DB, backup);

    expect((await listFriends(env.DB)).map(({ name }) => name)).toEqual(originalFriendNames);
    expect((await exportBlogData(env.DB)).posts).toHaveLength(6);
    expect((await exportBlogData(env.DB)).projects).toHaveLength(3);
  });
});
