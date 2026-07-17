import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { ADMIN_SESSION_COOKIE, createAdminSession } from "../../src/lib/admin/auth";
import { postMediaInputSchema } from "../../src/lib/admin/schemas";
import {
  AdminConflictError,
  AdminNotFoundError,
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
  getPost,
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
  syncPostAssetLinks,
} from "../../src/lib/database/media-repository";
import { POST as createPostRoute } from "../../src/pages/api/admin/posts/index";
import { PUT as updatePostRoute } from "../../src/pages/api/admin/posts/[id]";

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

function databaseWithBeforeBatch(operation: () => Promise<void>): D1Database {
  let raced = false;
  return {
    prepare: (...args: Parameters<D1Database["prepare"]>) => env.DB.prepare(...args),
    withSession: (...args: Parameters<D1Database["withSession"]>) => env.DB.withSession(...args),
    batch: async <T>(statements: D1PreparedStatement[]) => {
      if (!raced) {
        raced = true;
        await operation();
      }
      return env.DB.batch<T>(statements);
    },
  } as D1Database;
}

async function adminJsonRequest(
  method: "POST" | "PUT",
  path: string,
  body: unknown,
): Promise<Request> {
  const session = await createAdminSession(env.DB, undefined, undefined, env.ADMIN_SESSION_SECRET);
  return new Request(`https://example.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      cookie: `${ADMIN_SESSION_COOKIE}=${session.token}`,
    },
    body: JSON.stringify(body),
  });
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

  it("does not insert a post when a requested asset is missing", async () => {
    await expect(createPostWithMedia(env.DB, postInput("post-missing-asset"), {
      retainedAssetIds: ["33333333-3333-4333-8333-333333333333"],
    })).rejects.toBeInstanceOf(AdminNotFoundError);

    expect((await listPosts(env.DB)).some(({ slug }) => slug === "post-missing-asset")).toBe(false);
  });

  it("reports not found when an article is deleted after the update precheck", async () => {
    const post = await createPost(env.DB, postInput("post-concurrent-delete"));
    const asset = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/post-concurrent-delete.png",
      originalName: "post-concurrent-delete.png",
      contentType: "image/png",
      sizeBytes: 4,
    });
    await markMediaReady(env.DB, asset.id);
    const racingDatabase = databaseWithBeforeBatch(async () => {
      await env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(post.id).run();
    });

    await expect(updatePostWithMedia(racingDatabase, post.id, {
      ...post,
      title: "不应保存的标题",
    }, { retainedAssetIds: [asset.id] })).rejects.toBeInstanceOf(AdminNotFoundError);
    await expect(getPost(env.DB, post.id)).rejects.toBeInstanceOf(AdminNotFoundError);
  });

  it.each(["state", "draft"] as const)(
    "rolls back the article and links when asset %s changes after resolution",
    async (race) => {
      const post = await createPost(env.DB, postInput(`post-${race}-race`));
      const current = await beginMediaUpload(env.DB, {
        key: `uploads/2026/07/post-${race}-current.png`,
        originalName: `post-${race}-current.png`,
        contentType: "image/png",
        sizeBytes: 4,
      });
      const replacement = await beginMediaUpload(env.DB, {
        key: `uploads/2026/07/post-${race}-replacement.png`,
        originalName: `post-${race}-replacement.png`,
        contentType: "image/png",
        sizeBytes: 4,
        draftToken,
      });
      await markMediaReady(env.DB, current.id);
      await markMediaReady(env.DB, replacement.id);
      await syncPostAssetLinks(env.DB, post.id, {
        retainedAssetIds: [current.id],
        inlineKeys: [],
      });
      const racingDatabase = databaseWithBeforeBatch(async () => {
        if (race === "state") {
          await env.DB.prepare("UPDATE media_assets SET state = 'pending_delete' WHERE id = ?")
            .bind(replacement.id).run();
        } else {
          await env.DB.prepare("UPDATE media_assets SET draft_token = ? WHERE id = ?")
            .bind("22222222-2222-4222-8222-222222222222", replacement.id).run();
        }
      });

      await expect(updatePostWithMedia(racingDatabase, post.id, {
        ...post,
        title: "不应保存的标题",
      }, {
        draftToken,
        retainedAssetIds: [replacement.id],
      })).rejects.toBeInstanceOf(AdminConflictError);

      expect(await getPost(env.DB, post.id)).toMatchObject({ title: post.title });
      expect((await listPostAssets(env.DB, post.id)).map(({ id }) => id)).toEqual([current.id]);
    },
  );

  it("removes one post's old links without disturbing another post's shared link", async () => {
    const first = await createPost(env.DB, postInput("post-remove-old-links"));
    const second = await createPost(env.DB, postInput("post-keep-shared-link"));
    const exclusive = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/post-exclusive.png",
      originalName: "post-exclusive.png",
      contentType: "image/png",
      sizeBytes: 4,
    });
    const shared = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/post-shared.png",
      originalName: "post-shared.png",
      contentType: "image/png",
      sizeBytes: 4,
    });
    await markMediaReady(env.DB, exclusive.id);
    await markMediaReady(env.DB, shared.id);
    await syncPostAssetLinks(env.DB, first.id, {
      retainedAssetIds: [exclusive.id, shared.id],
      inlineKeys: [],
    });
    await syncPostAssetLinks(env.DB, second.id, {
      retainedAssetIds: [shared.id],
      inlineKeys: [],
    });

    await updatePostWithMedia(env.DB, first.id, { ...first, title: "已移除旧图片" }, {
      retainedAssetIds: [],
    });

    expect(await listPostAssets(env.DB, first.id)).toEqual([]);
    expect((await listPostAssets(env.DB, second.id)).map(({ id }) => id)).toEqual([shared.id]);
  });

  it("accepts 100 retained asset ids and rejects 101", () => {
    const assetId = "44444444-4444-4444-8444-444444444444";
    expect(postMediaInputSchema.parse({
      retainedAssetIds: Array(100).fill(assetId),
    }).retainedAssetIds).toHaveLength(100);
    expect(() => postMediaInputSchema.parse({ retainedAssetIds: Array(101).fill(assetId) }))
      .toThrow();
  });

  it("updates an article without images through the media-aware save path", async () => {
    const post = await createPost(env.DB, {
      ...postInput("post-update-without-images"),
      cover: "https://images.example/unchanged.png",
      coverAlt: "外部封面",
    });

    const updated = await updatePostWithMedia(env.DB, post.id, {
      ...post,
      title: "无图片更新",
    }, { retainedAssetIds: [] });

    expect(updated).toMatchObject({
      title: "无图片更新",
      cover: "https://images.example/unchanged.png",
      coverAlt: "外部封面",
    });
    expect(await listPostAssets(env.DB, post.id)).toEqual([]);
  });

  it("maps a missing article update to HTTP 404", async () => {
    const request = await adminJsonRequest("PUT", "/api/admin/posts/missing", {
      ...postInput("route-missing-post"),
      retainedAssetIds: [],
    });
    const response = await updatePostRoute({
      request,
      params: { id: "55555555-5555-4555-8555-555555555555" },
    } as never);

    expect(response.status).toBe(404);
  });

  it("maps a mismatched draft asset to HTTP 409", async () => {
    const asset = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/route-draft-conflict.png",
      originalName: "route-draft-conflict.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });
    await markMediaReady(env.DB, asset.id);
    const request = await adminJsonRequest("POST", "/api/admin/posts", {
      ...postInput("route-draft-conflict"),
      draftToken: "22222222-2222-4222-8222-222222222222",
      retainedAssetIds: [asset.id],
    });
    const response = await createPostRoute({ request } as never);

    expect(response.status).toBe(409);
  });

  it("maps invalid post media input to HTTP 422", async () => {
    const request = await adminJsonRequest("POST", "/api/admin/posts", {
      ...postInput("route-invalid-media"),
      draftToken: "not-a-uuid",
    });
    const response = await createPostRoute({ request } as never);

    expect(response.status).toBe(422);
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
