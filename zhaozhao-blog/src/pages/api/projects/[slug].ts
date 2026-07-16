import type { APIRoute } from "astro";
import { loadRuntimeProjects } from "../../../lib/runtime-content";

export const GET: APIRoute = async ({ params }) => {
  const project = (await loadRuntimeProjects()).find(({ id }) => id === params.slug);
  return project
    ? Response.json(project, { headers: { "cache-control": "no-store" } })
    : Response.json({ error: "Project not found" }, { status: 404 });
};
