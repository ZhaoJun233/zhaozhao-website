import type { APIRoute } from "astro";
import { handleAdminRequest } from "../../../../../../lib/admin/http";
import { listPostAssets } from "../../../../../../lib/database/media-repository";

export const GET: APIRoute = ({ request, params }) => handleAdminRequest(
  request,
  (database) => listPostAssets(database, params.id!),
);
