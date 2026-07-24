import { describe, expect, it } from "vitest";
import { buildSiteRedirect } from "../../src/lib/https";

describe("production site redirect", () => {
  it("redirects the legacy domain while preserving the path and query", () => {
    expect(buildSiteRedirect(
      new URL("https://zhao233.de5.net/posts/example/?from=mobile"),
      "https://zhao233.xyz",
      "https://zhao233.de5.net",
    )?.toString()).toBe("https://zhao233.xyz/posts/example/?from=mobile");
  });

  it("upgrades HTTP requests for the primary domain", () => {
    expect(buildSiteRedirect(
      new URL("http://zhao233.xyz/posts/example/?from=mobile"),
      "https://zhao233.xyz",
      "https://zhao233.de5.net",
    )?.toString()).toBe("https://zhao233.xyz/posts/example/?from=mobile");
  });

  it("does not redirect local development, workers.dev, or primary HTTPS requests", () => {
    expect(buildSiteRedirect(
      new URL("http://127.0.0.1:4322/"),
      "https://zhao233.xyz",
      "https://zhao233.de5.net",
    )).toBeUndefined();
    expect(buildSiteRedirect(
      new URL("http://zhao233.xyz/"),
      "https://zhao233.xyz",
      "https://zhao233.de5.net",
      "127.0.0.1:4322",
    )).toBeUndefined();
    expect(buildSiteRedirect(
      new URL("http://zhao233.xyz/"),
      "https://zhao233.xyz",
      "https://zhao233.de5.net",
      "[::1]:4322",
    )).toBeUndefined();
    expect(buildSiteRedirect(
      new URL("https://zhaozhao-website.zhaozhao7991.workers.dev/"),
      "https://zhao233.xyz",
      "https://zhao233.de5.net",
    )).toBeUndefined();
    expect(buildSiteRedirect(
      new URL("https://zhao233.xyz/"),
      "https://zhao233.xyz",
      "https://zhao233.de5.net",
    )).toBeUndefined();
  });
});
