import { describe, expect, it } from "vitest";
import { openBlogDatabase } from "../../src/lib/database/connection";
import { initializeBlogDatabase } from "../../src/lib/database/schema";
import {
  AdminConflictError,
  createFriend,
  deleteCategory,
  deleteFriend,
  exportBlogData,
  importBlogData,
  listCategories,
  listFriends,
  listPosts,
  orderFriends,
  updateFriend,
  updatePost,
  updateSetting,
} from "../../src/lib/database/admin-repository";

function createDatabase() {
  const database = openBlogDatabase(":memory:");
  initializeBlogDatabase(database, "src");
  return database;
}

describe("administrator content operations", () => {
  it("creates, edits, orders, disables, and deletes friends", () => {
    const database = createDatabase();
    const created = createFriend(database, {
      name: "测试友链",
      url: "https://friend.example/",
      description: "用于验证数据库后台。",
      interests: ["测试", "博客"],
      enabled: true,
    });
    expect(listFriends(database)).toHaveLength(5);

    const updated = updateFriend(database, created.id, {
      ...created,
      name: "已修改友链",
      enabled: false,
    });
    expect(updated.name).toBe("已修改友链");
    expect(updated.enabled).toBe(false);

    const ids = listFriends(database).map(({ id }) => id).reverse();
    orderFriends(database, ids);
    expect(listFriends(database).map(({ id }) => id)).toEqual(ids);

    deleteFriend(database, created.id);
    expect(listFriends(database)).toHaveLength(4);
    database.close();
  });

  it("protects categories referenced by posts", () => {
    const database = createDatabase();
    const category = listCategories(database).find(({ name }) => name === "开发");
    expect(category).toBeDefined();
    expect(() => deleteCategory(database, category!.id)).toThrow(AdminConflictError);
    database.close();
  });

  it("updates articles and structured site settings", () => {
    const database = createDatabase();
    const post = listPosts(database)[0]!;
    const updatedPost = updatePost(database, post.id, { ...post, title: "数据库文章标题" });
    expect(updatedPost.title).toBe("数据库文章标题");

    const profile = updateSetting(database, "profile", {
      name: "数据库博主",
      siteTitle: "数据库小站",
      description: "数据库说明",
      bio: "数据库简介",
      avatar: "/src/assets/profile/avatar.jpg",
      occupation: "独立开发者",
      location: "杭州",
      motto: "持续记录，持续创造。",
      email: "hello@example.com",
      website: "https://example.com/",
    }) as { name: string };
    expect(profile.name).toBe("数据库博主");
    expect(profile).toMatchObject({
      occupation: "独立开发者",
      location: "杭州",
      motto: "持续记录，持续创造。",
      email: "hello@example.com",
      website: "https://example.com/",
    });
    database.close();
  });

  it("exports and atomically restores the complete content database", () => {
    const database = createDatabase();
    const backup = exportBlogData(database);
    const originalFriendNames = backup.friends.map(({ name }) => name);
    const friend = listFriends(database)[0]!;
    updateFriend(database, friend.id, { ...friend, name: "临时修改" });

    importBlogData(database, backup);

    expect(listFriends(database).map(({ name }) => name)).toEqual(originalFriendNames);
    expect(exportBlogData(database).posts).toHaveLength(6);
    expect(exportBlogData(database).projects).toHaveLength(3);
    database.close();
  });
});
