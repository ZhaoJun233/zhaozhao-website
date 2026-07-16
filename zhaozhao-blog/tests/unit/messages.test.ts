import { describe, expect, it } from "vitest";
import { openBlogDatabase } from "../../src/lib/database/connection";
import { initializeBlogDatabase } from "../../src/lib/database/schema";
import {
  createGuestbookMessage,
  deleteGuestbookMessage,
  listAdminMessages,
  listApprovedMessages,
  updateGuestbookMessageStatus,
} from "../../src/lib/database/message-repository";

function createDatabase() {
  const database = openBlogDatabase(":memory:");
  initializeBlogDatabase(database, "src");
  return database;
}

describe("database guestbook messages", () => {
  it("stores new messages as pending and publishes only approved entries", () => {
    const database = createDatabase();
    const message = createGuestbookMessage(database, {
      name: "来访者",
      email: "visitor@example.com",
      website: "https://visitor.example/",
      content: "你好，这是数据库留言。",
    });

    expect(message.status).toBe("pending");
    expect(listApprovedMessages(database)).toHaveLength(0);
    expect(listAdminMessages(database)[0]?.email).toBe("visitor@example.com");

    updateGuestbookMessageStatus(database, message.id, "approved");
    const published = listApprovedMessages(database);
    expect(published).toHaveLength(1);
    expect(published[0]).not.toHaveProperty("email");
    expect(published[0]?.content).toBe("你好，这是数据库留言。");
    database.close();
  });

  it("allows the administrator to hide and delete a message", () => {
    const database = createDatabase();
    const message = createGuestbookMessage(database, { name: "测试", content: "待处理留言" });
    updateGuestbookMessageStatus(database, message.id, "spam");
    expect(listAdminMessages(database)[0]?.status).toBe("spam");
    deleteGuestbookMessage(database, message.id);
    expect(listAdminMessages(database)).toHaveLength(0);
    database.close();
  });
});
