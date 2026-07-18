import { describe, expect, it } from "vitest";
import { resolveHomePostLayout } from "../../src/lib/home-post-layout";

describe("home featured post layout", () => {
  it.each([
    { count: 0, leadHasCover: false, expected: "empty" },
    { count: 1, leadHasCover: false, expected: "single" },
    { count: 1, leadHasCover: true, expected: "single" },
    { count: 2, leadHasCover: false, expected: "pair" },
    { count: 2, leadHasCover: true, expected: "pair" },
    { count: 3, leadHasCover: false, expected: "grid" },
    { count: 3, leadHasCover: true, expected: "lead" },
  ])("uses $expected for $count posts", ({ count, leadHasCover, expected }) => {
    expect(resolveHomePostLayout(count, leadHasCover)).toBe(expected);
  });

  it("treats larger inputs like a three-card homepage selection", () => {
    expect(resolveHomePostLayout(8, true)).toBe("lead");
    expect(resolveHomePostLayout(8, false)).toBe("grid");
  });
});
