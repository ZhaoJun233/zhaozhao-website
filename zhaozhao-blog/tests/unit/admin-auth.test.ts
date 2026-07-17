import { describe, expect, it } from "vitest";
import {
  ADMIN_SESSION_COOKIE,
  clearAdminSessionCookie,
  readAdminSessionToken,
  serializeAdminSessionCookie,
  verifyAdminPassword,
} from "../../src/lib/admin/auth";

describe("single administrator authentication utilities", () => {
  it("compares the configured password without accepting near matches", () => {
    expect(verifyAdminPassword("correct horse", "correct horse")).toBe(true);
    expect(verifyAdminPassword("correct horse!", "correct horse")).toBe(false);
    expect(verifyAdminPassword("", "correct horse")).toBe(false);
  });

  it("serializes and reads a strict administrator session cookie", () => {
    const expiresAt = new Date("2026-07-20T10:00:00.000Z");
    const cookie = serializeAdminSessionCookie("token value", expiresAt, true);
    const request = new Request("https://blog.example/admin/", {
      headers: { cookie },
    });

    expect(cookie).toContain(`${ADMIN_SESSION_COOKIE}=token%20value`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(readAdminSessionToken(request)).toBe("token value");
    expect(clearAdminSessionCookie(true)).toContain("Max-Age=0");
  });
});
