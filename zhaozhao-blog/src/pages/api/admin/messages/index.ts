import type { APIRoute } from "astro";
import { handleAdminRequest } from "../../../../lib/admin/http";
import { getDatabase } from "../../../../lib/cloudflare/bindings";
import { listAdminMessages } from "../../../../lib/database/message-repository";

export const GET: APIRoute = ({ request }) => handleAdminRequest(
  request,
  () => listAdminMessages(getDatabase()),
);
