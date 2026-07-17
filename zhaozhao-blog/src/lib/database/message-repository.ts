import { randomUUID } from "node:crypto";
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

function publicMessage(row: MessageRow): PublicMessage {
  return {
    id: row.id,
    name: row.name,
    ...(row.website ? { website: row.website } : {}),
    content: row.content,
    createdAt: row.created_at,
  };
}

async function row(database: D1DatabaseSession, id: string): Promise<MessageRow> {
  const result = await database.prepare("SELECT * FROM guestbook_messages WHERE id = ?")
    .bind(id).first<MessageRow>();
  if (!result) throw new AdminNotFoundError("留言不存在。");
  return result;
}

export async function createGuestbookMessage(
  database: D1Database,
  input: unknown,
): Promise<AdminMessage> {
  const value = messageInputSchema.parse(input);
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  const session = database.withSession("first-primary");
  await session.prepare(
    `INSERT INTO guestbook_messages
     (id, name, email, website, content, status, ip_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  ).bind(id, value.name, value.email ?? null, value.website ?? null, value.content,
    value.ipHash ?? null, timestamp, timestamp).run();
  return adminMessage(await row(session, id));
}

export async function listAdminMessages(database: D1Database): Promise<AdminMessage[]> {
  const { results } = await database.withSession("first-primary").prepare(
    "SELECT * FROM guestbook_messages ORDER BY created_at DESC",
  ).all<MessageRow>();
  return results.map(adminMessage);
}

export async function listApprovedMessages(database: D1Database): Promise<PublicMessage[]> {
  const { results } = await database.withSession("first-primary").prepare(
    "SELECT * FROM guestbook_messages WHERE status = 'approved' ORDER BY created_at DESC",
  ).all<MessageRow>();
  return results.map(publicMessage);
}

export async function updateGuestbookMessageStatus(
  database: D1Database,
  id: string,
  status: MessageStatus,
): Promise<AdminMessage> {
  const value = messageStatusSchema.parse(status);
  const session = database.withSession("first-primary");
  const result = await session.prepare(
    "UPDATE guestbook_messages SET status = ?, updated_at = ? WHERE id = ?",
  ).bind(value, new Date().toISOString(), id).run();
  if ((result.meta.changes ?? 0) === 0) throw new AdminNotFoundError("留言不存在。");
  return adminMessage(await row(session, id));
}

export async function deleteGuestbookMessage(database: D1Database, id: string): Promise<void> {
  const result = await database.prepare("DELETE FROM guestbook_messages WHERE id = ?")
    .bind(id).run();
  if ((result.meta.changes ?? 0) === 0) throw new AdminNotFoundError("留言不存在。");
}
