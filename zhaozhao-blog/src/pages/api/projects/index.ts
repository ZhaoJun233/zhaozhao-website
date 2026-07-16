import type { APIRoute } from "astro";
import { loadRuntimeProjects } from "../../../lib/runtime-content";

export const GET: APIRoute = async () => {
  const projects = (await loadRuntimeProjects()).sort(
    (left, right) => right.data.date.getTime() - left.data.date.getTime(),
  );
  return Response.json(projects.map(({ html: _html, ...project }) => project), {
    headers: { "cache-control": "no-store" },
  });
};
