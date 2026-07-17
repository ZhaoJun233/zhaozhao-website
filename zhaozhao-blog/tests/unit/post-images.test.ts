import { describe, expect, it } from "vitest";
import {
  extractManagedImageKeys,
  mediaKeyFromUrl,
  mediaUrlFromKey,
} from "../../src/lib/admin/post-images";

describe("managed article images", () => {
  it("normalizes only uploads keys", () => {
    expect(mediaUrlFromKey("uploads/2026/07/a.webp"))
      .toBe("/media/uploads/2026/07/a.webp");
    expect(mediaKeyFromUrl("/media/uploads/2026/07/a.webp?x=1"))
      .toBe("uploads/2026/07/a.webp");
    expect(mediaKeyFromUrl("/media/backgrounds/home-hero.png")).toBeUndefined();
    expect(mediaKeyFromUrl("https://images.example/a.webp")).toBeUndefined();
    expect(() => mediaUrlFromKey("uploads/2026/07/a.svg"))
      .toThrow("图片路径不正确。");
  });

  it("extracts unique Markdown and HTML image keys in source order", () => {
    const source = [
      "![封面](/media/uploads/2026/07/a.webp)",
      '<img src="/media/uploads/2026/07/b.png" alt="正文">',
      "![重复](/media/uploads/2026/07/a.webp)",
      "[普通链接](/media/uploads/2026/07/not-an-image.webp)",
    ].join("\n");

    expect(extractManagedImageKeys(source)).toEqual([
      "uploads/2026/07/a.webp",
      "uploads/2026/07/b.png",
    ]);
  });

  it("preserves source order when HTML appears before Markdown", () => {
    const source = [
      '<img src="/media/uploads/2026/07/b.png" alt="正文">',
      "![封面](/media/uploads/2026/07/a.webp)",
    ].join("\n");

    expect(extractManagedImageKeys(source)).toEqual([
      "uploads/2026/07/b.png",
      "uploads/2026/07/a.webp",
    ]);
  });

  it("ignores malformed percent-encoding without interrupting extraction", () => {
    const malformed = "/media/uploads/2026/07/bad%ZZ.png";
    const source = [
      `![损坏](${malformed})`,
      "![有效](/media/uploads/2026/07/a.webp)",
    ].join("\n");

    expect(mediaKeyFromUrl(malformed)).toBeUndefined();
    expect(extractManagedImageKeys(source)).toEqual([
      "uploads/2026/07/a.webp",
    ]);
  });
});
