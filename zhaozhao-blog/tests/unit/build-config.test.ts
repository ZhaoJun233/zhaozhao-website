import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSiteUrl } from "../../src/config/build";

describe("deployment site URL", () => {
  it("builds through the Cloudflare adapter", () => {
    const config = readFileSync(resolve("astro.config.mjs"), "utf8");
    expect(config).toContain('from "@astrojs/cloudflare"');
    expect(config).toContain("cloudflare(");
    expect(config).not.toContain("@astrojs/node");
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
