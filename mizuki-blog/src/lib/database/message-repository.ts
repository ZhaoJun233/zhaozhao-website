import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "astro/zod";
import { AdminNotFoundError } from "./admin-repository";

const optionalText = z.string().trim().transform((value) => value || undefined).optional();
export const messageInputSchema = z.object({
  name: z.string().trim().min(1).max(40),
  email: z.email().optional().or(z.literal("")).transform((value) => value || undefined),
  website: z.url({ protocol: /^https?$/ }).optional().or(z.literal("")).transform((value) => value || undefined),
  content: z.string().trim().min(2).max(2_000),
  ipHash: optionalText,
});
export const messageStatusSchema = z.enum(["pending", "approved", "spam"]);
export type MessageStatus = z.infer<typeof messageStatusSchema>;

interface MessageRow {
  id: string;
  name: string;
  email: string | null;
  website: string | null;
  content: string;
  status: MessageStatus;
  ip_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminMessage {
  id: string;
  name: string;
  email?: string;
  website?: string;
  content: string;
  status: MessageStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PublicMessage {
  id: string;
  name: string;
  website?: string;
  content: string;
  createdAt: string;
}

function adminMessage(row: MessageRow): AdminMessage {
  return {
    id: row.id,
    name: row.name,
    ...(row.email ? { email: row.email } : {}),
    ...(row.website ? { website: row.website } : {}),
    content: row.content,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function row(database: DatabaseSync, id: string): MessageRow {
  const result = database.prepare("SELECT * FROM guestbook_messages WHERE id = ?").get(id) as
    unknown as MessageRow | undefined;
  if (!result) throw new AdminNotFoundError("留言不存在。");
  return result;
}

export function createGuestbookMessage(database: DatabaseSync, input: unknown): AdminMessage {
  const value = messageInputSchema.parse(input);
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  database.prepare(
    `INSERT INTO guestbook_messages
     (id, name, email, website, content, status, ip_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  ).run(id, value.name, value.email ?? null, value.website ?? null, value.content,
    value.ipHash ?? null, timestamp, timestamp);
  return adminMessage(row(database, id));
}

export function listAdminMessages(database: DatabaseSync): AdminMessage[] {
  const rows = database.prepare(
    "SELECT * FROM guestbook_messages ORDER BY created_at DESC",
  ).all() as unknown as MessageRow[];
  return rows.map(adminMessage);
}

export function listApprovedMessages(database: DatabaseSync): PublicMessage[] {
  const rows = database.prepare(
    "SELECT * FROM guestbook_messages WHERE status = 'approved' ORDER BY created_at DESC",
  ).all() as unknown as MessageRow[];
  return rows.map((item) => ({
    id: item.id,
    name: item.name,
    ...(item.website ? { website: item.website } : {}),
    content: item.content,
    createdAt: item.created_at,
  }));
}

export function updateGuestbookMessageStatus(
  database: DatabaseSync,
  id: string,
  status: MessageStatus,
): AdminMessage {
  const value = messageStatusSchema.parse(status);
  if (database.prepare(
    "UPDATE guestbook_messages SET status = ?, updated_at = ? WHERE id = ?",
  ).run(value, new Date().toISOString(), id).changes === 0) {
    throw new AdminNotFoundError("留言不存在。");
  }
  return adminMessage(row(database, id));
}

export function deleteGuestbookMessage(database: DatabaseSync, id: string): void {
  if (database.prepare("DELETE FROM guestbook_messages WHERE id = ?").run(id).changes === 0) {
    throw new AdminNotFoundError("留言不存在。");
  }
}
