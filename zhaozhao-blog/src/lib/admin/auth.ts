import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "admin_session";
const sevenDays = 7 * 24 * 60 * 60 * 1_000;

export interface AdminSession {
  token: string;
  expiresAt: Date;
}

function comparableSecret(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function sessionDigest(
  token: string,
  secret = process.env.ADMIN_SESSION_SECRET ?? "local-development-session-secret",
): string {
  return createHmac("sha256", secret).update(token, "utf8").digest("hex");
}

export function verifyAdminPassword(candidate: string, configured = process.env.ADMIN_PASSWORD ?? ""): boolean {
  if (!candidate || !configured) return false;
  return timingSafeEqual(comparableSecret(candidate), comparableSecret(configured));
}

export async function createAdminSession(
  database: D1Database,
  now = new Date(),
  lifetimeMs = sevenDays,
  secret?: string,
): Promise<AdminSession> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(now.getTime() + lifetimeMs);
  await database.batch([
    database.prepare("DELETE FROM admin_sessions WHERE expires_at <= ?").bind(now.toISOString()),
    database.prepare(
      "INSERT INTO admin_sessions (token_digest, created_at, expires_at) VALUES (?, ?, ?)",
    ).bind(sessionDigest(token, secret), now.toISOString(), expiresAt.toISOString()),
  ]);
  return { token, expiresAt };
}

export async function authenticateAdminSession(
  database: D1Database,
  token: string | undefined,
  now = new Date(),
  secret?: string,
): Promise<{ expiresAt: Date } | null> {
  if (!token) return null;
  const digest = sessionDigest(token, secret);
  const row = await database.withSession("first-primary").prepare(
    "SELECT expires_at FROM admin_sessions WHERE token_digest = ?",
  ).bind(digest).first<{ expires_at: string }>();
  if (!row) return null;
  const expiresAt = new Date(row.expires_at);
  if (expiresAt.getTime() <= now.getTime()) {
    await database.prepare("DELETE FROM admin_sessions WHERE token_digest = ?").bind(digest).run();
    return null;
  }
  return { expiresAt };
}

export async function deleteAdminSession(
  database: D1Database,
  token: string | undefined,
  secret?: string,
): Promise<void> {
  if (!token) return;
  await database.prepare("DELETE FROM admin_sessions WHERE token_digest = ?")
    .bind(sessionDigest(token, secret)).run();
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
