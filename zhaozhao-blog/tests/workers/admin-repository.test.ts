import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  AdminConflictError,
  createCategory,
  createFriend,
  createPost,
  createPostWithMedia,
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
  updatePostWithMedia,
  updateSetting,
} from "../../src/lib/database/admin-repository";
import {
  beginMediaUpload,
  listPostAssets,
  markMediaReady,
} from "../../src/lib/database/media-repository";

const draftToken = "11111111-1111-4111-8111-111111111111";

function postInput(slug: string) {
  return {
    slug,
    title: "图片生命周期测试",
    description: "验证文章保存同步图片引用。",
    body: "## 正文\n\n测试内容。",
    publishedAt: "2026-07-17T00:00:00.000Z",
    draft: true,
    category: "开发",
    tags: ["Astro"],
    featured: false,
  };
}

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

  it("creates a post with its managed cover and retained library asset", async () => {
    const asset = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/post-create-cover.png",
      originalName: "post-create-cover.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });
    await markMediaReady(env.DB, asset.id);

    const created = await createPostWithMedia(env.DB, {
      ...postInput("post-create-with-media"),
      cover: "/static/ignored-cover.png",
      coverAlt: "文章封面",
    }, {
      draftToken,
      coverAssetId: asset.id,
      retainedAssetIds: [asset.id],
    });

    expect(created.cover).toBe(`/media/${asset.key}`);
    expect(await listPostAssets(env.DB, created.id)).toEqual([
      expect.objectContaining({ id: asset.id, usages: ["cover", "library"] }),
    ]);
  });

  it("updates managed cover, inline, and library usages in one save", async () => {
    const post = await createPost(env.DB, postInput("post-update-with-media"));
    const asset = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/post-update-image.png",
      originalName: "post-update-image.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });
    await markMediaReady(env.DB, asset.id);

    const updated = await updatePostWithMedia(env.DB, post.id, {
      ...post,
      body: `![正文图片](/media/${asset.key})`,
      cover: "/static/ignored-cover.png",
      coverAlt: "文章封面",
    }, {
      draftToken,
      coverAssetId: asset.id,
      retainedAssetIds: [asset.id],
    });

    expect(updated.cover).toBe(`/media/${asset.key}`);
    expect(await listPostAssets(env.DB, post.id)).toEqual([
      expect.objectContaining({
        id: asset.id,
        usages: ["cover", "inline", "library"],
      }),
    ]);
  });

  it("rejects a managed draft asset from a different editing session", async () => {
    const asset = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/post-invalid-draft.png",
      originalName: "post-invalid-draft.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });
    await markMediaReady(env.DB, asset.id);

    await expect(createPostWithMedia(env.DB, postInput("post-invalid-draft"), {
      draftToken: "22222222-2222-4222-8222-222222222222",
      retainedAssetIds: [asset.id],
    })).rejects.toBeInstanceOf(AdminConflictError);
    expect((await listPosts(env.DB)).some(({ slug }) => slug === "post-invalid-draft")).toBe(false);
  });

  it("keeps unmanaged cover fields when no managed cover is selected", async () => {
    const created = await createPostWithMedia(env.DB, {
      ...postInput("post-static-cover"),
      cover: "https://images.example/static-cover.png",
      coverAlt: "外部封面",
    }, { retainedAssetIds: [] });

    expect(created).toMatchObject({
      cover: "https://images.example/static-cover.png",
      coverAlt: "外部封面",
    });
    expect(await listPostAssets(env.DB, created.id)).toEqual([]);
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
