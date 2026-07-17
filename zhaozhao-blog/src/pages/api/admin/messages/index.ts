import type { APIRoute } from "astro";
import { handleAdminRequest } from "../../../../lib/admin/http";
import { listAdminMessages } from "../../../../lib/database/message-repository";

export const GET: APIRoute = ({ request }) => handleAdminRequest(
  request,
  listAdminMessages,
);
