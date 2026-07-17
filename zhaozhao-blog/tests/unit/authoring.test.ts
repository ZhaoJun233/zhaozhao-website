import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const root = resolve(appRoot, "..");
const packageJson = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8"));

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

  it("uses the Cloudflare Worker adapter with D1 and R2 bindings", () => {
    expect(packageJson.dependencies).toHaveProperty("@astrojs/cloudflare", "14.1.3");
    expect(packageJson.dependencies).not.toHaveProperty("@astrojs/node");
    const wrangler = JSON.parse(readFileSync(resolve(appRoot, "wrangler.jsonc"), "utf8"));
    expect(wrangler).toMatchObject({
      name: "zhaozhao-website",
      compatibility_date: "2026-07-17",
      compatibility_flags: ["nodejs_compat"],
      d1_databases: [{ binding: "DB", database_name: "zhaozhao-blog" }],
      r2_buckets: [{ binding: "MEDIA", bucket_name: "zhaozhao-media" }],
    });
    expect(wrangler.assets.directory).toBe("./dist");
  });

  it("documents Cloudflare secrets and removes Docker deployment files", () => {
    const environmentExample = readFileSync(resolve(appRoot, ".dev.vars.example"), "utf8");
    expect(environmentExample).toContain("ADMIN_PASSWORD=");
    expect(environmentExample).toContain("ADMIN_SESSION_SECRET=");
    expect(existsSync(resolve(appRoot, "docker-compose.yml"))).toBe(false);
    expect(existsSync(resolve(appRoot, "Dockerfile"))).toBe(false);
    const ignore = readFileSync(resolve(root, ".gitignore"), "utf8");
    expect(ignore).toContain(".wrangler/");
    expect(ignore).toContain(".dev.vars");
  });
});
