import { describe, expect, it } from "vitest";
import { taxonomySlug } from "../../src/lib/slug";

describe("taxonomySlug", () => {
  it("keeps Chinese taxonomy readable and normalizes punctuation", () => {
    expect(taxonomySlug(" 动画 / 随笔 ")).toBe("动画-随笔");
  });
});
