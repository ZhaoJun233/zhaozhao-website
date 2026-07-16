import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type ComposeService = {
  build: { args?: Record<string, string>; context: string; target?: string };
  environment?: Record<string, string>;
  healthcheck?: { test: string[] };
  ports?: string[];
  volumes?: string[];
};
type ComposeConfig = {
  services: Record<string, ComposeService>;
  volumes?: Record<string, unknown>;
};

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const root = resolve(appRoot, "..");
const packageJson = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8"));
const compose = parse(readFileSync(resolve(appRoot, "docker-compose.yml"), "utf8")) as ComposeConfig;
const dockerfile = readFileSync(resolve(appRoot, "Dockerfile"), "utf8");
const environmentExample = readFileSync(resolve(appRoot, ".env.example"), "utf8");

describe("database-backed authoring", () => {
  it("ships a custom admin workspace for every maintainable content area", () => {
    for (const page of [
      "index", "login", "posts", "projects", "categories", "friends", "messages", "content", "data",
    ]) {
      expect(existsSync(resolve(appRoot, `src/pages/admin/${page}.astro`))).toBe(true);
    }
    const adminIndex = readFileSync(resolve(appRoot, "src/pages/admin/index.astro"), "utf8");
    expect(adminIndex).toContain("AdminShell");
    expect(adminIndex).not.toContain("decap-cms-app");
    expect(existsSync(resolve(appRoot, "public/admin/config.yml"))).toBe(false);
  });

  it("removes Decap dependencies and file-authoring scripts", () => {
    expect(packageJson.dependencies).not.toHaveProperty("decap-cms-app");
    expect(packageJson.devDependencies).not.toHaveProperty("decap-server");
    expect(packageJson.scripts).not.toHaveProperty("cms");
    expect(packageJson.scripts).not.toHaveProperty("author");
    expect(existsSync(resolve(appRoot, "scripts/start-cms.mjs"))).toBe(false);
  });

  it("runs one SSR service with a persistent SQLite volume", () => {
    expect(Object.keys(compose.services)).toEqual(["site"]);
    const site = compose.services.site!;
    expect(site.build).toMatchObject({ context: ".", target: "runtime" });
    expect(site.ports).toEqual(["127.0.0.1:4321:4321"]);
    expect(site.volumes).toContain("blog-data:/app/storage");
    expect(site.volumes).toContain("./src/data:/app/src/data:ro");
    expect(site.environment).toMatchObject({
      CONTENT_ROOT: "/app/src",
      BLOG_DATABASE_PATH: "/app/storage/blog.sqlite",
      ADMIN_PASSWORD: "${ADMIN_PASSWORD:-233zhao-local-admin}",
      ADMIN_SESSION_SECRET: "${ADMIN_SESSION_SECRET:-change-this-local-session-secret}",
    });
    expect(compose.volumes).toHaveProperty("blog-data");
  });

  it("documents the required database and administrator environment", () => {
    expect(environmentExample).toContain("BLOG_DATABASE_PATH=");
    expect(environmentExample).toContain("ADMIN_PASSWORD=");
    expect(environmentExample).toContain("ADMIN_SESSION_SECRET=");
    expect(dockerfile).toContain('CMD ["node", "dist/server/entry.mjs"]');
    expect(dockerfile).toContain("/app/storage");
    expect(readFileSync(resolve(root, ".gitignore"), "utf8")).toContain("storage/*.sqlite");
  });
});
