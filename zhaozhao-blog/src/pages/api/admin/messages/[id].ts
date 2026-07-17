import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import { getDatabase } from "../../../../lib/cloudflare/bindings";
import {
  deleteGuestbookMessage,
  updateGuestbookMessageStatus,
} from "../../../../lib/database/message-repository";

const inputSchema = z.object({ status: z.enum(["pending", "approved", "spam"]) });

export const PUT: APIRoute = ({ request, params }) => handleAdminRequest(request, async () => {
  const { status } = inputSchema.parse(await readAdminJson(request));
  return updateGuestbookMessageStatus(getDatabase(), params.id!, status);
});

export const DELETE: APIRoute = ({ request, params }) => handleAdminRequest(request, async () => {
  await deleteGuestbookMessage(getDatabase(), params.id!);
  return { deleted: true };
});
