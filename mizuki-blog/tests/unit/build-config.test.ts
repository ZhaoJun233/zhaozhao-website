import { describe, expect, it } from "vitest";
import { resolveSiteUrl } from "../../src/config/build";

describe("deployment site URL", () => {
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
