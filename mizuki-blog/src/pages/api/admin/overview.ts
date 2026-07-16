import type { APIRoute } from "astro";
import { handleAdminRequest } from "../../../lib/admin/http";
import { getAdminOverview } from "../../../lib/database/admin-repository";

export const GET: APIRoute = ({ request }) => handleAdminRequest(request, getAdminOverview);
