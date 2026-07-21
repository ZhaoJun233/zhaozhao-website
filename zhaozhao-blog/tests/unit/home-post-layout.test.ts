import { describe, expect, it } from "vitest";
import { resolveHomePostLayout } from "../../src/lib/home-post-layout";

describe("home featured post layout", () => {
  it.each([
    { count: 0, expected: "empty" },
    { count: 1, expected: "single" },
    { count: 2, expected: "pair" },
    { count: 3, expected: "grid" },
  ])("uses $expected for $count posts", ({ count, expected }) => {
    expect(resolveHomePostLayout(count)).toBe(expected);
  });

  it("treats larger inputs like a three-card homepage selection", () => {
    expect(resolveHomePostLayout(8)).toBe("grid");
  });
});
