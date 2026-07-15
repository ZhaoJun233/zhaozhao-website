import { describe, expect, it } from "vitest";
import {
  buildBlogPostingJsonLd,
  buildCanonical,
  buildWebsiteJsonLd,
} from "../../src/lib/seo";

describe("seo", () => {
  it("builds canonical URLs with trailing slashes", () => {
    expect(buildCanonical("/posts/hello")).toBe(
      "http://localhost:4321/posts/hello/",
    );
    expect(buildCanonical("/posts/hello/?view=full#intro")).toBe(
      "http://localhost:4321/posts/hello/?view=full#intro",
    );
  });

  it("preserves file routes and canonical overrides", () => {
    expect(buildCanonical("/rss.xml")).toBe("http://localhost:4321/rss.xml");
    expect(buildCanonical("https://journal.example/notes/one")).toBe(
      "https://journal.example/notes/one/",
    );
  });

  it("declares a Chinese website schema", () => {
    const schema = buildWebsiteJsonLd();

    expect(schema["@type"]).toBe("WebSite");
    expect(schema.inLanguage).toBe("zh-CN");
    expect(schema.publisher["@type"]).toBe("Person");
  });

  it("builds a fully linked Chinese BlogPosting schema", () => {
    const schema = buildBlogPostingJsonLd({
      title: "夏日动画随记",
      description: "关于海风与镜头语言的随记。",
      path: "/posts/summer-notes/",
      publishedAt: new Date("2026-07-12T00:00:00.000Z"),
      updatedAt: "2026-07-13T00:00:00.000Z",
      image: "/social/summer.jpg",
      tags: ["动画", "随记"],
    });

    expect(schema["@type"]).toBe("BlogPosting");
    expect(schema.mainEntityOfPage["@id"]).toBe(
      "http://localhost:4321/posts/summer-notes/",
    );
    expect(schema.image).toEqual([
      "http://localhost:4321/social/summer.jpg",
    ]);
    expect(schema.dateModified).toBe("2026-07-13T00:00:00.000Z");
    expect(schema.keywords).toBe("动画, 随记");
    expect(schema.inLanguage).toBe("zh-CN");
  });
});
