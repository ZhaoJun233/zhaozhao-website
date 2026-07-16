import type { DatabaseSync } from "node:sqlite";
import { z } from "astro/zod";
import { authenticateAdminSession, readAdminSessionToken } from "./auth";
import { getContentDatabase } from "../database/content-repository";
import { AdminConflictError, AdminNotFoundError } from "../database/admin-repository";

const maxBodyBytes = 1024 * 1024;

export class AdminHttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "AdminHttpError";
  }
}

export async function readAdminJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new AdminHttpError(415, "管理接口只接受 JSON。" );
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maxBodyBytes) throw new AdminHttpError(413, "请求内容超过 1 MiB。" );
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBodyBytes) {
    throw new AdminHttpError(413, "请求内容超过 1 MiB。" );
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new AdminHttpError(400, "JSON 格式不正确。" );
  }
}

function requireSameOrigin(request: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    throw new AdminHttpError(403, "请求来源不受信任。" );
  }
}

function requireAdmin(request: Request): DatabaseSync {
  requireSameOrigin(request);
  const database = getContentDatabase();
  const session = authenticateAdminSession(database, readAdminSessionToken(request));
  if (!session) throw new AdminHttpError(401, "后台会话已失效，请重新登录。" );
  return database;
}

function errorResponse(error: unknown): Response {
  if (error instanceof AdminHttpError) {
    return Response.json({ error: error.message }, { status: error.status, headers: { "cache-control": "no-store" } });
  }
  if (error instanceof AdminNotFoundError) {
    return Response.json({ error: error.message }, { status: 404, headers: { "cache-control": "no-store" } });
  }
  if (error instanceof AdminConflictError) {
    return Response.json({ error: error.message, details: error.details }, {
      status: 409,
      headers: { "cache-control": "no-store" },
    });
  }
  if (error instanceof z.ZodError) {
    return Response.json({
      error: "提交内容未通过校验。",
      fieldErrors: z.flattenError(error).fieldErrors,
    }, { status: 422, headers: { "cache-control": "no-store" } });
  }
  if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
    return Response.json({ error: "名称、网址或 Slug 已经存在。" }, {
      status: 409,
      headers: { "cache-control": "no-store" },
    });
  }
  console.error(error);
  return Response.json({ error: "后台处理请求时出现错误。" }, {
    status: 500,
    headers: { "cache-control": "no-store" },
  });
}

export async function handleAdminRequest(
  request: Request,
  operation: (database: DatabaseSync) => unknown | Promise<unknown>,
): Promise<Response> {
  try {
    const result = await operation(requireAdmin(request));
    if (result instanceof Response) return result;
    return Response.json({ data: result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
