import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("browser-friendly RSS feed", () => {
  it("attaches a local XSL presentation without changing the feed endpoint", () => {
    const route = readFileSync(resolve("src/pages/rss.xml.ts"), "utf8");
    const stylesheet = resolve("public/rss-feed.xsl");

    expect(route).toContain('stylesheet: "/rss-feed.xsl"');
    expect(existsSync(stylesheet)).toBe(true);
    expect(readFileSync(stylesheet, "utf8")).toContain("xsl:for-each select=\"item\"");
  });
});
