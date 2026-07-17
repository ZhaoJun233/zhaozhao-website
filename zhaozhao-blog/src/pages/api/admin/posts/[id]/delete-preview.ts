import type { APIRoute } from "astro";
import { handleAdminRequest } from "../../../../../lib/admin/http";
import { previewPostDelete } from "../../../../../lib/database/media-repository";

export const GET: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  (database) => previewPostDelete(database, params.id!),
);
