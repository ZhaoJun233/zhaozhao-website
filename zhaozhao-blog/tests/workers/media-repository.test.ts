import { describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

describe("article media schema", () => {
  it("creates media assets, post links, and cleanup jobs", async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    const names = tables.results.map(({ name }) => name);

    expect(names).toContain("media_assets");
    expect(names).toContain("post_asset_links");
    expect(names).toContain("media_cleanup_jobs");
  });
});
