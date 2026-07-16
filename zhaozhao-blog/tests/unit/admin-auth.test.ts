import { describe, expect, it } from "vitest";
import { openBlogDatabase } from "../../src/lib/database/connection";
import { initializeBlogDatabase } from "../../src/lib/database/schema";
import {
  authenticateAdminSession,
  createAdminSession,
  deleteAdminSession,
  verifyAdminPassword,
} from "../../src/lib/admin/auth";

function createDatabase() {
  const database = openBlogDatabase(":memory:");
  initializeBlogDatabase(database, "src");
  return database;
}

describe("single administrator authentication", () => {
  it("compares the configured password without accepting near matches", () => {
    expect(verifyAdminPassword("correct horse", "correct horse")).toBe(true);
    expect(verifyAdminPassword("correct horse!", "correct horse")).toBe(false);
    expect(verifyAdminPassword("", "correct horse")).toBe(false);
  });

  it("stores only a digest and authenticates the issued token", () => {
    const database = createDatabase();
    const now = new Date("2026-07-16T10:00:00.000Z");

    const session = createAdminSession(database, now);
    const stored = database.prepare("SELECT token_digest FROM admin_sessions").get();

    expect(session.token).toHaveLength(64);
    expect(stored?.token_digest).not.toBe(session.token);
    expect(authenticateAdminSession(database, session.token, now)?.expiresAt)
      .toEqual(session.expiresAt);
    database.close();
  });

  it("rejects expired sessions and deletes sessions on logout", () => {
    const database = createDatabase();
    const createdAt = new Date("2026-07-01T00:00:00.000Z");
    const session = createAdminSession(database, createdAt, 1_000);

    expect(authenticateAdminSession(
      database,
      session.token,
      new Date("2026-07-01T00:00:02.000Z"),
    )).toBeNull();

    const active = createAdminSession(database, new Date("2026-07-16T00:00:00.000Z"));
    deleteAdminSession(database, active.token);
    expect(authenticateAdminSession(database, active.token)).toBeNull();
    database.close();
  });
});
