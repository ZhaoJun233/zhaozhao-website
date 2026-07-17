import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import {
  deleteGuestbookMessage,
  updateGuestbookMessageStatus,
} from "../../../../lib/database/message-repository";

const inputSchema = z.object({ status: z.enum(["pending", "approved", "spam"]) });

export const PUT: APIRoute = ({ request, params }) => handleAdminRequest(request, async (database) => {
  const { status } = inputSchema.parse(await readAdminJson(request));
  return updateGuestbookMessageStatus(database, params.id!, status);
});

export const DELETE: APIRoute = ({ request, params }) => handleAdminRequest(request, async (database) => {
  await deleteGuestbookMessage(database, params.id!);
  return { deleted: true };
});
