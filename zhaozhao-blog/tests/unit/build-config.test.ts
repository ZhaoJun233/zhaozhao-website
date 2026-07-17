import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSiteUrl } from "../../src/config/build";

describe("deployment site URL", () => {
  it("runs unit and Workers integration tests by default", () => {
    const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts.test).toBe("npm run test:unit && npm run test:workers");
    expect(packageJson.scripts["test:unit"]).toBe("vitest run");
  });

  it("keeps production runtime free of SQLite and filesystem state", () => {
    const files: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        const path = resolve(directory, entry);
        if (statSync(path).isDirectory()) visit(path);
        else if (/\.(?:astro|ts)$/.test(path)) files.push(path);
      }
    };
    visit(resolve("src"));
    const source = files.map((path) => readFileSync(path, "utf8")).join("\n");
    for (const forbidden of ["node:sqlite", "BLOG_DATABASE_PATH", "CONTENT_ROOT", "node:fs"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("reserves port 4322 for isolated Cloudflare preview tests", () => {
    const config = readFileSync(resolve("playwright.config.ts"), "utf8");
    expect(config).toContain('baseURL: "http://127.0.0.1:4322"');
    expect(config).not.toContain("BLOG_DATABASE_PATH");
  });

  it("builds through the Cloudflare adapter", () => {
    const config = readFileSync(resolve("astro.config.mjs"), "utf8");
    expect(config).toContain('from "@astrojs/cloudflare"');
    expect(config).toContain("cloudflare(");
    expect(config).not.toContain("@astrojs/node");
    expect(config).toContain('replace(/^\\.+/, "_")');
  });

  it("keeps a stable localhost default for development and local tests", () => {
    expect(resolveSiteUrl({})).toBe("http://localhost:4321");
  });

  it("requires an explicit canonical origin for deployment builds", () => {
    expect(() => resolveSiteUrl({ BUILD_MODE: "production" })).toThrow(
      /PUBLIC_SITE_URL is required/,
    );
    expect(resolveSiteUrl({
      BUILD_MODE: "production",
      PUBLIC_SITE_URL: "https://blog.example.com/",
    })).toBe("https://blog.example.com");
  });

  it("rejects non-web deployment URL schemes", () => {
    expect(() => resolveSiteUrl({ PUBLIC_SITE_URL: "ftp://example.com" })).toThrow(
      /HTTP or HTTPS/,
    );
  });
});
