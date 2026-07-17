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

  it("uses the Cloudflare Worker adapter with D1 and KV bindings", () => {
    expect(packageJson.dependencies).toHaveProperty("@astrojs/cloudflare", "14.1.3");
    expect(packageJson.dependencies).not.toHaveProperty("@astrojs/node");
    const wrangler = JSON.parse(readFileSync(resolve(appRoot, "wrangler.jsonc"), "utf8"));
    expect(wrangler).toMatchObject({
      name: "zhaozhao-website",
      compatibility_date: "2026-07-17",
      compatibility_flags: ["nodejs_compat"],
      d1_databases: [{ binding: "DB", database_name: "zhaozhao-blog" }],
      kv_namespaces: [{ binding: "MEDIA" }],
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

  it("documents the complete Cloudflare deployment and JSON cutover workflow", () => {
    const deploymentPath = resolve(appRoot, "docs/CLOUDFLARE-DEPLOYMENT.md");
    expect(existsSync(deploymentPath)).toBe(true);
    const documentation = ["README.md", "AUTHORING.md", "docs/CONTENT-MAINTENANCE.md"]
      .map((path) => readFileSync(resolve(appRoot, path), "utf8"))
      .join("\n");
    const deployment = readFileSync(deploymentPath, "utf8");
    for (const command of [
      "npx wrangler d1 create zhaozhao-blog",
      "npx wrangler kv namespace create zhaozhao-media",
      "npx wrangler secret put ADMIN_PASSWORD",
      "npx wrangler secret put ADMIN_SESSION_SECRET",
      "npm run db:migrate:remote",
      "npm run deploy",
    ]) expect(deployment).toContain(command);
    expect(deployment).toContain("ZhaoJun233/zhaozhao-website");
    expect(deployment).toContain("database_id");
    expect(deployment).toContain("JSON");
    expect(documentation).not.toMatch(/Docker|SQLite|BLOG_DATABASE_PATH/);
    expect(existsSync(resolve(appRoot, ".env.example"))).toBe(false);
  });
});
