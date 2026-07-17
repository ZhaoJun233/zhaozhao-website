import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import {
  authenticateAdminSession,
  createAdminSession,
  deleteAdminSession,
  verifyAdminPassword,
} from "../../src/lib/admin/auth";
import {
  createGuestbookMessage,
  deleteGuestbookMessage,
  listAdminMessages,
  listApprovedMessages,
  updateGuestbookMessageStatus,
} from "../../src/lib/database/message-repository";

describe("D1 administrator sessions", () => {
  it("stores only a digest and authenticates the issued token", async () => {
    const now = new Date("2026-07-16T10:00:00.000Z");
    const session = await createAdminSession(env.DB, now, undefined, env.ADMIN_SESSION_SECRET);
    const stored = await env.DB.prepare(
      "SELECT token_digest FROM admin_sessions",
    ).first<{ token_digest: string }>();

    expect(verifyAdminPassword("test-admin-password", env.ADMIN_PASSWORD)).toBe(true);
    expect(session.token).toHaveLength(64);
    expect(stored?.token_digest).not.toBe(session.token);
    expect((await authenticateAdminSession(
      env.DB,
      session.token,
      now,
      env.ADMIN_SESSION_SECRET,
    ))?.expiresAt)
      .toEqual(session.expiresAt);
  });

  it("rejects expiry and deletes sessions on logout", async () => {
    const createdAt = new Date("2026-07-01T00:00:00.000Z");
    const expired = await createAdminSession(env.DB, createdAt, 1_000, env.ADMIN_SESSION_SECRET);

    expect(await authenticateAdminSession(
      env.DB,
      expired.token,
      new Date("2026-07-01T00:00:02.000Z"),
      env.ADMIN_SESSION_SECRET,
    )).toBeNull();

    const active = await createAdminSession(
      env.DB,
      new Date("2026-07-16T00:00:00.000Z"),
      undefined,
      env.ADMIN_SESSION_SECRET,
    );
    await deleteAdminSession(env.DB, active.token, env.ADMIN_SESSION_SECRET);
    expect(await authenticateAdminSession(
      env.DB,
      active.token,
      undefined,
      env.ADMIN_SESSION_SECRET,
    )).toBeNull();
  });
});

describe("D1 guestbook messages", () => {
  it("stores pending messages and publishes only approved entries", async () => {
    const message = await createGuestbookMessage(env.DB, {
      name: "来访者",
      email: "visitor@example.com",
      website: "https://visitor.example/",
      content: "你好，这是数据库留言。",
    });

    expect(message.status).toBe("pending");
    expect(await listApprovedMessages(env.DB)).toHaveLength(0);
    expect((await listAdminMessages(env.DB))[0]?.email).toBe("visitor@example.com");

    await updateGuestbookMessageStatus(env.DB, message.id, "approved");
    const published = await listApprovedMessages(env.DB);
    expect(published).toHaveLength(1);
    expect(published[0]).not.toHaveProperty("email");
    expect(published[0]?.content).toBe("你好，这是数据库留言。");
  });

  it("allows moderation and deletion", async () => {
    const message = await createGuestbookMessage(env.DB, {
      name: "测试",
      content: "待处理留言",
    });
    await updateGuestbookMessageStatus(env.DB, message.id, "spam");
    expect((await listAdminMessages(env.DB))[0]?.status).toBe("spam");
    await deleteGuestbookMessage(env.DB, message.id);
    expect(await listAdminMessages(env.DB)).toHaveLength(0);
  });
});
