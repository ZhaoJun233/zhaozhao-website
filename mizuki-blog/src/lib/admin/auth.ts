import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export const ADMIN_SESSION_COOKIE = "admin_session";
const sevenDays = 7 * 24 * 60 * 60 * 1_000;

export interface AdminSession {
  token: string;
  expiresAt: Date;
}

function comparableSecret(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function sessionDigest(token: string): string {
  const secret = process.env.ADMIN_SESSION_SECRET ?? "local-development-session-secret";
  return createHmac("sha256", secret).update(token, "utf8").digest("hex");
}

export function verifyAdminPassword(candidate: string, configured = process.env.ADMIN_PASSWORD ?? ""): boolean {
  if (!candidate || !configured) return false;
  return timingSafeEqual(comparableSecret(candidate), comparableSecret(configured));
}

export function createAdminSession(
  database: DatabaseSync,
  now = new Date(),
  lifetimeMs = sevenDays,
): AdminSession {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + lifetimeMs);
  database.prepare(
    "INSERT INTO admin_sessions (token_digest, created_at, expires_at) VALUES (?, ?, ?)",
  ).run(sessionDigest(token), now.toISOString(), expiresAt.toISOString());
  return { token, expiresAt };
}

export function authenticateAdminSession(
  database: DatabaseSync,
  token: string | undefined,
  now = new Date(),
): { expiresAt: Date } | null {
  if (!token) return null;
  const digest = sessionDigest(token);
  const row = database.prepare(
    "SELECT expires_at FROM admin_sessions WHERE token_digest = ?",
  ).get(digest) as { expires_at?: string } | undefined;
  if (!row?.expires_at) return null;
  const expiresAt = new Date(row.expires_at);
  if (expiresAt.getTime() <= now.getTime()) {
    database.prepare("DELETE FROM admin_sessions WHERE token_digest = ?").run(digest);
    return null;
  }
  return { expiresAt };
}

export function deleteAdminSession(database: DatabaseSync, token: string | undefined): void {
  if (!token) return;
  database.prepare("DELETE FROM admin_sessions WHERE token_digest = ?").run(sessionDigest(token));
}

export function readAdminSessionToken(request: Request): string | undefined {
  const cookie = request.headers.get("cookie") ?? "";
  for (const item of cookie.split(";")) {
    const [name, ...value] = item.trim().split("=");
    if (name === ADMIN_SESSION_COOKIE) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

export function serializeAdminSessionCookie(
  token: string,
  expiresAt: Date,
  secure: boolean,
): string {
  return [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Expires=${expiresAt.toUTCString()}`,
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function clearAdminSessionCookie(secure: boolean): string {
  return [
    `${ADMIN_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}
