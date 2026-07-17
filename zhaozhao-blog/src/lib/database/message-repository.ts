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

async function d1Row(database: D1DatabaseSession, id: string): Promise<MessageRow> {
  const result = await database.prepare("SELECT * FROM guestbook_messages WHERE id = ?")
    .bind(id).first<MessageRow>();
  if (!result) throw new AdminNotFoundError("留言不存在。");
  return result;
}

function isD1Database(database: DatabaseSync | D1Database): database is D1Database {
  return "withSession" in database;
}

export function createGuestbookMessage(database: D1Database, input: unknown): Promise<AdminMessage>;
export function createGuestbookMessage(database: DatabaseSync, input: unknown): AdminMessage;
export function createGuestbookMessage(
  database: DatabaseSync | D1Database,
  input: unknown,
): AdminMessage | Promise<AdminMessage> {
  const value = messageInputSchema.parse(input);
  const id = randomUUID();
  const timestamp = new Date().toISOString();
  if (isD1Database(database)) {
    return (async () => {
      const session = database.withSession("first-primary");
      await session.prepare(
        `INSERT INTO guestbook_messages
         (id, name, email, website, content, status, ip_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      ).bind(id, value.name, value.email ?? null, value.website ?? null, value.content,
        value.ipHash ?? null, timestamp, timestamp).run();
      return adminMessage(await d1Row(session, id));
    })();
  }
  database.prepare(
    `INSERT INTO guestbook_messages
     (id, name, email, website, content, status, ip_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  ).run(id, value.name, value.email ?? null, value.website ?? null, value.content,
    value.ipHash ?? null, timestamp, timestamp);
  return adminMessage(row(database, id));
}

export function listAdminMessages(database: D1Database): Promise<AdminMessage[]>;
export function listAdminMessages(database: DatabaseSync): AdminMessage[];
export function listAdminMessages(
  database: DatabaseSync | D1Database,
): AdminMessage[] | Promise<AdminMessage[]> {
  if (isD1Database(database)) {
    return database.withSession("first-primary").prepare(
      "SELECT * FROM guestbook_messages ORDER BY created_at DESC",
    ).all<MessageRow>().then(({ results }) => results.map(adminMessage));
  }
  const rows = database.prepare(
    "SELECT * FROM guestbook_messages ORDER BY created_at DESC",
  ).all() as unknown as MessageRow[];
  return rows.map(adminMessage);
}

function publicMessage(item: MessageRow): PublicMessage {
  return {
    id: item.id,
    name: item.name,
    ...(item.website ? { website: item.website } : {}),
    content: item.content,
    createdAt: item.created_at,
  };
}

export function listApprovedMessages(database: D1Database): Promise<PublicMessage[]>;
export function listApprovedMessages(database: DatabaseSync): PublicMessage[];
export function listApprovedMessages(
  database: DatabaseSync | D1Database,
): PublicMessage[] | Promise<PublicMessage[]> {
  if (isD1Database(database)) {
    return database.withSession("first-primary").prepare(
      "SELECT * FROM guestbook_messages WHERE status = 'approved' ORDER BY created_at DESC",
    ).all<MessageRow>().then(({ results }) => results.map(publicMessage));
  }
  const rows = database.prepare(
    "SELECT * FROM guestbook_messages WHERE status = 'approved' ORDER BY created_at DESC",
  ).all() as unknown as MessageRow[];
  return rows.map(publicMessage);
}

export function updateGuestbookMessageStatus(
  database: D1Database,
  id: string,
  status: MessageStatus,
): Promise<AdminMessage>;
export function updateGuestbookMessageStatus(
  database: DatabaseSync,
  id: string,
  status: MessageStatus,
): AdminMessage;
export function updateGuestbookMessageStatus(
  database: DatabaseSync | D1Database,
  id: string,
  status: MessageStatus,
): AdminMessage | Promise<AdminMessage> {
  const value = messageStatusSchema.parse(status);
  if (isD1Database(database)) {
    return (async () => {
      const session = database.withSession("first-primary");
      const result = await session.prepare(
        "UPDATE guestbook_messages SET status = ?, updated_at = ? WHERE id = ?",
      ).bind(value, new Date().toISOString(), id).run();
      if ((result.meta.changes ?? 0) === 0) throw new AdminNotFoundError("留言不存在。");
      return adminMessage(await d1Row(session, id));
    })();
  }
  if (database.prepare(
    "UPDATE guestbook_messages SET status = ?, updated_at = ? WHERE id = ?",
  ).run(value, new Date().toISOString(), id).changes === 0) {
    throw new AdminNotFoundError("留言不存在。");
  }
  return adminMessage(row(database, id));
}

export function deleteGuestbookMessage(database: D1Database, id: string): Promise<void>;
export function deleteGuestbookMessage(database: DatabaseSync, id: string): void;
export function deleteGuestbookMessage(
  database: DatabaseSync | D1Database,
  id: string,
): void | Promise<void> {
  if (isD1Database(database)) {
    return database.prepare("DELETE FROM guestbook_messages WHERE id = ?").bind(id).run()
      .then((result) => {
        if ((result.meta.changes ?? 0) === 0) throw new AdminNotFoundError("留言不存在。");
      });
  }
  if (database.prepare("DELETE FROM guestbook_messages WHERE id = ?").run(id).changes === 0) {
    throw new AdminNotFoundError("留言不存在。");
  }
}
