import { describe, expect, it } from "vitest";
import { buildHttpsRedirect } from "../../src/lib/https";

describe("production HTTPS redirect", () => {
  it("redirects the public HTTP domain while preserving the path and query", () => {
    expect(buildHttpsRedirect(
      new URL("http://zhao233.de5.net/posts/example/?from=mobile"),
      "https://zhao233.de5.net",
    )?.toString()).toBe("https://zhao233.de5.net/posts/example/?from=mobile");
  });

  it("does not redirect local development or an existing HTTPS request", () => {
    expect(buildHttpsRedirect(
      new URL("http://127.0.0.1:4322/"),
      "https://zhao233.de5.net",
    )).toBeUndefined();
    expect(buildHttpsRedirect(
      new URL("https://zhao233.de5.net/"),
      "https://zhao233.de5.net",
    )).toBeUndefined();
  });
});
