import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { ADMIN_SESSION_COOKIE, createAdminSession } from "../../src/lib/admin/auth";
import { postMediaInputSchema } from "../../src/lib/admin/schemas";
import { storeAdminMedia } from "../../src/lib/cloudflare/media";
import { backfillPostMedia } from "../../src/lib/cloudflare/post-media";
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
  claimMediaCleanupJobs,
  failMediaUpload,
  listMediaCleanupJobs,
  listPostAssets,
  markMediaReady,
  queueDraftCleanup,
  syncPostAssetLinks,
} from "../../src/lib/database/media-repository";
import { POST as createPostRoute } from "../../src/pages/api/admin/posts/index";
import { PUT as updatePostRoute } from "../../src/pages/api/admin/posts/[id]";
import { POST as importBlogRoute } from "../../src/pages/api/admin/import";

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

function databaseWithBatchObserver(
  batchSizes: number[],
  beforeBatch?: () => Promise<void>,
): D1Database {
  return {
    prepare: (...args: Parameters<D1Database["prepare"]>) => env.DB.prepare(...args),
    withSession: (...args: Parameters<D1Database["withSession"]>) => env.DB.withSession(...args),
    batch: async <T>(statements: D1PreparedStatement[]) => {
      await beforeBatch?.();
      batchSizes.push(statements.length);
      return env.DB.batch<T>(statements);
    },
  } as D1Database;
}

async function insertBackupAssets(postId: string, count: number, prefix: string): Promise<void> {
  const timestamp = "2026-07-17T00:00:00.000Z";
  const assets = Array.from({ length: count }, (_, index) => ({
    id: `90000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
    key: `uploads/2026/07/${prefix}-${index}.png`,
    name: `${prefix}-${index}.png`,
  }));
  const statements: D1PreparedStatement[] = [];
  for (let offset = 0; offset < assets.length; offset += 25) {
    const chunk = assets.slice(offset, offset + 25);
    statements.push(env.DB.prepare(
      `INSERT INTO media_assets
       (id, kv_key, original_name, content_type, size_bytes, state, draft_token, created_at)
       VALUES ${chunk.map(() => "(?, ?, ?, 'image/png', 4, 'ready', NULL, ?)").join(", ")}`,
    ).bind(...chunk.flatMap((asset) => [asset.id, asset.key, asset.name, timestamp])));
    statements.push(env.DB.prepare(
      `INSERT INTO post_asset_links (post_id, asset_id, usage, sort_order, created_at)
       VALUES ${chunk.map(() => "(?, ?, 'library', ?, ?)").join(", ")}`,
    ).bind(...chunk.flatMap((asset, index) => [
      postId,
      asset.id,
      offset + index,
      timestamp,
    ])));
  }
  await env.DB.batch(statements);
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

    expect(created.cover).toBe(`/media/${asset.key}/`);
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

    expect(updated.cover).toBe(`/media/${asset.key}/`);
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

  it("exports backup schema 2 with linked ready media metadata but no object bytes", async () => {
    const post = await createPost(env.DB, {
      ...postInput("backup-media-manifest"),
      body: "![backup](/media/uploads/2026/07/backup-media.png)",
    });
    const asset = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/backup-media.png",
      originalName: "backup-media.png",
      contentType: "image/png",
      sizeBytes: 12,
    });
    await markMediaReady(env.DB, asset.id);
    await syncPostAssetLinks(env.DB, post.id, {
      retainedAssetIds: [asset.id],
      inlineKeys: [asset.key],
    });

    const backup = await exportBlogData(env.DB);

    expect(backup.schemaVersion).toBe(2);
    if (backup.schemaVersion !== 2) throw new Error("Expected schema version 2.");
    expect(backup.mediaAssets).toContainEqual({
      kvKey: asset.key,
      originalName: "backup-media.png",
      contentType: "image/png",
      sizeBytes: 12,
    });
    expect(backup.postAssetLinks).toEqual(expect.arrayContaining([
      { postId: post.id, kvKey: asset.key, usage: "library", sortOrder: 0 },
      { postId: post.id, kvKey: asset.key, usage: "inline", sortOrder: 0 },
    ]));
    expect(JSON.stringify(backup)).not.toContain("objectBytes");
  });

  it("continues to accept schema version 1 backups", async () => {
    const current = await exportBlogData(env.DB);
    if (current.schemaVersion !== 2) throw new Error("Expected schema version 2.");
    const { mediaAssets: _mediaAssets, postAssetLinks: _postAssetLinks, ...base } = current;
    const versionOne = { ...base, schemaVersion: 1 as const };
    const originalTitles = versionOne.posts.map(({ title }) => title);
    const post = versionOne.posts[0]!;
    await updatePostWithMedia(env.DB, post.id, { ...post, title: "临时标题" }, {
      retainedAssetIds: [],
    });

    await importBlogData(env.DB, versionOne);

    expect((await listPosts(env.DB)).map(({ title }) => title)).toEqual(originalTitles);
  });

  it("restores schema version 2 links, cancels restored cleanup, and queues stale keys", async () => {
    const post = await createPost(env.DB, {
      ...postInput("backup-v2-restore"),
      body: "![restored](/media/uploads/2026/07/backup-restored.png/)",
    });
    const restored = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/backup-restored.png",
      originalName: "backup-restored.png",
      contentType: "image/png",
      sizeBytes: 8,
    });
    await markMediaReady(env.DB, restored.id);
    await syncPostAssetLinks(env.DB, post.id, {
      retainedAssetIds: [restored.id],
      inlineKeys: [restored.key],
    });
    const backup = await exportBlogData(env.DB);
    if (backup.schemaVersion !== 2) throw new Error("Expected schema version 2.");

    const stalePost = await createPost(env.DB, postInput("backup-v2-stale-post"));
    const stale = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/backup-stale.png",
      originalName: "backup-stale.png",
      contentType: "image/png",
      sizeBytes: 5,
    });
    await markMediaReady(env.DB, stale.id);
    await syncPostAssetLinks(env.DB, stalePost.id, {
      retainedAssetIds: [stale.id],
      inlineKeys: [],
    });
    await env.DB.batch([
      env.DB.prepare("UPDATE media_assets SET state = 'pending_delete' WHERE id = ?")
        .bind(restored.id),
      env.DB.prepare(
        `INSERT INTO media_cleanup_jobs (asset_id, kv_key, reason, queued_at)
         VALUES (?, ?, 'manual_remove', ?)`,
      ).bind(restored.id, restored.key, "2026-07-17T00:00:00.000Z"),
    ]);

    await importBlogData(env.DB, backup);

    expect(await env.DB.prepare("SELECT state FROM media_assets WHERE id = ?")
      .bind(restored.id).first()).toEqual({ state: "ready" });
    expect((await listPostAssets(env.DB, post.id))[0]).toMatchObject({
      key: restored.key,
      usages: ["inline", "library"],
    });
    expect(await listMediaCleanupJobs(env.DB)).toMatchObject([
      { asset_id: stale.id, kv_key: stale.key, reason: "backup_restore" },
    ]);
  });

  it("backfills legacy post images after a schema version 1 import", async () => {
    const legacy = await storeAdminMedia(
      env.MEDIA,
      new File(["legacy-import"], "legacy-import.gif", { type: "image/gif" }),
      new Date("2026-07-17T00:00:00.000Z"),
    );
    const post = await createPost(env.DB, {
      ...postInput("legacy-import-backfill"),
      body: `![legacy import](${legacy.url})`,
    });
    const current = await exportBlogData(env.DB);
    if (current.schemaVersion !== 2) throw new Error("Expected schema version 2.");
    const { mediaAssets: _mediaAssets, postAssetLinks: _postAssetLinks, ...base } = current;
    const versionOne = { ...base, schemaVersion: 1 as const };

    const response = await importBlogRoute({
      request: await adminJsonRequest("POST", "/api/admin/import/", versionOne),
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { imported: true } });
    for (let page = 0; page < 10 && (await listPostAssets(env.DB, post.id)).length === 0; page += 1) {
      await backfillPostMedia(env.DB, env.MEDIA, { batchSize: 3 });
    }
    expect((await listPostAssets(env.DB, post.id))[0]).toMatchObject({
      key: legacy.key,
      usages: ["inline", "library"],
    });
  });

  it.each([
    { label: "missing mediaAssets", mutate: (backup: Record<string, unknown>) => {
      delete backup.mediaAssets;
    } },
    { label: "null postAssetLinks", mutate: (backup: Record<string, unknown>) => {
      backup.postAssetLinks = null;
    } },
    { label: "damaged media element", mutate: (backup: Record<string, unknown>) => {
      backup.mediaAssets = [{ kvKey: 42, originalName: "broken", contentType: "image/png" }];
    } },
    { label: "damaged link element", mutate: (backup: Record<string, unknown>) => {
      backup.postAssetLinks = [{
        postId: "post",
        kvKey: "uploads/2026/07/broken.png",
        usage: "thumbnail",
        sortOrder: -1,
      }];
    } },
  ])("rejects $label in schema version 2 before database access", async ({ mutate }) => {
    const exported = await exportBlogData(env.DB);
    const damaged = structuredClone(exported) as unknown as Record<string, unknown>;
    mutate(damaged);
    let databaseOperations = 0;
    const inaccessibleDatabase = {
      prepare: () => {
        databaseOperations += 1;
        throw new Error("unexpected database access");
      },
      withSession: () => {
        databaseOperations += 1;
        throw new Error("unexpected database access");
      },
      batch: async () => {
        databaseOperations += 1;
        throw new Error("unexpected database access");
      },
    } as unknown as D1Database;

    await expect(importBlogData(inaccessibleDatabase, damaged as never))
      .rejects.toMatchObject({ name: "ZodError" });
    expect(databaseOperations).toBe(0);
  });

  it("returns a validation error for damaged v2 JSON without restoring or cleaning media", async () => {
    const pending = await beginMediaUpload(env.DB, {
      key: "uploads/2026/07/damaged-v2-guard.png",
      originalName: "damaged-v2-guard.png",
      contentType: "image/png",
      sizeBytes: 4,
    });
    await env.MEDIA.put(pending.key, "keep");
    await failMediaUpload(env.DB, pending.id);
    const backup = await exportBlogData(env.DB);
    const damaged = { ...backup, mediaAssets: null };
    const originalPosts = await listPosts(env.DB);

    const response = await importBlogRoute({
      request: await adminJsonRequest("POST", "/api/admin/import/", damaged),
    } as never);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "提交内容未通过校验。" });
    expect(await listPosts(env.DB)).toEqual(originalPosts);
    expect(await listMediaCleanupJobs(env.DB)).toContainEqual(expect.objectContaining({
      asset_id: pending.id,
      kv_key: pending.key,
      reason: "upload_failed",
    }));
    expect(await env.MEDIA.get(pending.key, "arrayBuffer")).not.toBeNull();
  });

  it.each([
    { label: "missing messages", mutate: (backup: Record<string, unknown>) => {
      delete backup.messages;
    } },
    { label: "null settings", mutate: (backup: Record<string, unknown>) => {
      backup.settings = null;
    } },
  ])("rejects $label in v2 without changing any backup content", async ({ mutate }) => {
    const before = await exportBlogData(env.DB);
    const damaged = structuredClone(before) as unknown as Record<string, unknown>;
    mutate(damaged);

    await expect(importBlogData(env.DB, damaged as never))
      .rejects.toMatchObject({ name: "ZodError" });

    const after = await exportBlogData(env.DB);
    expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
  });

  it.each([
    {
      label: "missing inline usage",
      mutate: (backup: Extract<Awaited<ReturnType<typeof exportBlogData>>, { schemaVersion: 2 }>, postId: string) => {
        backup.postAssetLinks = backup.postAssetLinks.filter(
          (link) => !(link.postId === postId && link.usage === "inline"),
        );
      },
    },
    {
      label: "missing library usage",
      mutate: (backup: Extract<Awaited<ReturnType<typeof exportBlogData>>, { schemaVersion: 2 }>, postId: string) => {
        backup.postAssetLinks = backup.postAssetLinks.filter(
          (link) => !(link.postId === postId && link.usage === "library"),
        );
      },
    },
    {
      label: "unreferenced active usage",
      mutate: (backup: Extract<Awaited<ReturnType<typeof exportBlogData>>, { schemaVersion: 2 }>, postId: string) => {
        const post = backup.posts.find(({ id }) => id === postId)!;
        post.body = "正文不再引用图片。";
      },
    },
  ])("rejects a v2 media graph with $label before changing content", async ({ mutate }) => {
    const key = `uploads/2026/07/backup-graph-${crypto.randomUUID()}.png`;
    const post = await createPost(env.DB, {
      ...postInput(`backup-graph-${crypto.randomUUID()}`),
      body: `![graph](/media/${key}/)`,
    });
    const asset = await beginMediaUpload(env.DB, {
      key,
      originalName: "graph.png",
      contentType: "image/png",
      sizeBytes: 4,
    });
    await markMediaReady(env.DB, asset.id);
    await syncPostAssetLinks(env.DB, post.id, {
      retainedAssetIds: [asset.id],
      inlineKeys: [key],
    });
    const before = await exportBlogData(env.DB);
    if (before.schemaVersion !== 2) throw new Error("Expected schema version 2.");
    const damaged = structuredClone(before);
    mutate(damaged, post.id);

    await expect(importBlogData(env.DB, damaged)).rejects.toMatchObject({ name: "ZodError" });
    const after = await exportBlogData(env.DB);
    expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
  });

  it("rejects a v2 cover link that no longer matches the article cover", async () => {
    const key = "uploads/2026/07/backup-cover-graph.png";
    const post = await createPost(env.DB, {
      ...postInput("backup-cover-graph"),
      cover: `/media/${key}/`,
      coverAlt: "Backup cover",
    });
    const asset = await beginMediaUpload(env.DB, {
      key,
      originalName: "cover.png",
      contentType: "image/png",
      sizeBytes: 4,
    });
    await markMediaReady(env.DB, asset.id);
    await syncPostAssetLinks(env.DB, post.id, {
      retainedAssetIds: [asset.id],
      coverAssetId: asset.id,
      inlineKeys: [],
    });
    const before = await exportBlogData(env.DB);
    if (before.schemaVersion !== 2) throw new Error("Expected schema version 2.");
    const damaged = structuredClone(before);
    damaged.posts.find(({ id }) => id === post.id)!.cover =
      "/media/uploads/2026/07/different-cover.png/";

    await expect(importBlogData(env.DB, damaged)).rejects.toMatchObject({ name: "ZodError" });
    const after = await exportBlogData(env.DB);
    expect({ ...after, exportedAt: before.exportedAt }).toEqual(before);
  });

  it("does not restore a media key already claimed by cleanup", async () => {
    const key = "uploads/2026/07/claimed-backup-restore.png";
    const post = await createPost(env.DB, {
      ...postInput("claimed-backup-restore"),
      body: `![claimed](/media/${key}/)`,
    });
    const asset = await beginMediaUpload(env.DB, {
      key,
      originalName: "claimed.png",
      contentType: "image/png",
      sizeBytes: 4,
      draftToken,
    });
    await markMediaReady(env.DB, asset.id);
    await syncPostAssetLinks(env.DB, post.id, {
      draftToken,
      retainedAssetIds: [asset.id],
      inlineKeys: [key],
    });
    const backup = await exportBlogData(env.DB);
    await env.DB.prepare("DELETE FROM post_asset_links WHERE asset_id = ?").bind(asset.id).run();
    await env.DB.prepare("UPDATE media_assets SET draft_token = ? WHERE id = ?")
      .bind(draftToken, asset.id).run();
    await queueDraftCleanup(env.DB, draftToken, "draft_cancelled");
    const [claim] = await claimMediaCleanupJobs(env.DB, 1, new Date("2026-07-17T01:00:00.000Z"));

    await expect(importBlogData(env.DB, backup)).rejects.toThrow();
    expect(await env.DB.prepare("SELECT state FROM media_assets WHERE id = ?")
      .bind(asset.id).first()).toEqual({ state: "pending_delete" });
    expect(await listMediaCleanupJobs(env.DB)).toContainEqual(expect.objectContaining({
      asset_id: asset.id,
      claim_token: claim!.claim_token,
    }));
  });

  it("round-trips more than eighty linked images within the import statement budget", async () => {
    const post = await createPost(env.DB, postInput("large-media-backup"));
    await insertBackupAssets(post.id, 120, "large-backup");
    const backup = await exportBlogData(env.DB);
    if (backup.schemaVersion !== 2) throw new Error("Expected schema version 2.");
    expect(backup.mediaAssets).toHaveLength(120);
    const batchSizes: number[] = [];

    await importBlogData(databaseWithBatchObserver(batchSizes), backup);

    expect(batchSizes).toHaveLength(1);
    expect(batchSizes[0]).toBeLessThanOrEqual(500);
    const restored = await exportBlogData(env.DB);
    expect(restored.schemaVersion).toBe(2);
    if (restored.schemaVersion !== 2) throw new Error("Expected schema version 2.");
    expect(restored.mediaAssets).toHaveLength(120);
    expect(restored.postAssetLinks).toHaveLength(120);
  });

  it("snapshots old assets inside the restore batch before selecting final stale keys", async () => {
    const backup = await exportBlogData(env.DB);
    if (backup.schemaVersion !== 2) throw new Error("Expected schema version 2.");
    const concurrent = {
      id: "99999999-9999-4999-8999-999999999999",
      key: "uploads/2026/07/concurrent-before-restore.png",
    };
    const batchSizes: number[] = [];
    const database = databaseWithBatchObserver(batchSizes, async () => {
      await env.DB.prepare(
        `INSERT INTO media_assets
         (id, kv_key, original_name, content_type, size_bytes, state, draft_token, created_at)
         VALUES (?, ?, 'concurrent.png', 'image/png', 4, 'ready', NULL, ?)`,
      ).bind(concurrent.id, concurrent.key, "2026-07-17T00:00:00.000Z").run();
    });

    await importBlogData(database, backup);

    expect(batchSizes).toHaveLength(1);
    expect(await listMediaCleanupJobs(env.DB)).toContainEqual(expect.objectContaining({
      asset_id: concurrent.id,
      kv_key: concurrent.key,
      reason: "backup_restore",
    }));
  });
});
