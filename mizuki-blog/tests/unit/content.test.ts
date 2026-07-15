import { describe, expect, it } from "vitest";
import {
  estimateReadingMinutes,
  getRelatedPosts,
  paginate,
  sortPosts,
} from "../../src/lib/content";
import { groupPostsByMonth } from "../../src/lib/date";

describe("content domain", () => {
  it("uses mixed Chinese and Latin reading speed", () => {
    expect(estimateReadingMinutes("海".repeat(400) + " word ".repeat(200))).toBe(2);
  });

  it("paginates deterministically", () => {
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual({
      items: [3, 4],
      page: 2,
      pageCount: 3,
      total: 5,
    });
  });

  it("scores category before one shared tag", () => {
    const current = {
      id: "a",
      publishedAt: new Date("2026-07-15"),
      category: "开发",
      tags: ["Astro"],
    };
    const related = getRelatedPosts(
      current,
      [
        {
          id: "b",
          publishedAt: new Date("2026-07-14"),
          category: "开发",
          tags: [],
        },
        {
          id: "c",
          publishedAt: new Date("2026-07-13"),
          category: "随笔",
          tags: ["Astro"],
        },
      ],
      3,
    );

    expect(related.map((item) => item.id)).toEqual(["b", "c"]);
  });

  it("sorts by publication date descending and slug ascending", () => {
    const posts = [
      { id: "z-post", publishedAt: new Date("2026-07-14") },
      { id: "b-post", publishedAt: new Date("2026-07-15") },
      { id: "a-post", publishedAt: new Date("2026-07-15") },
    ];

    expect(sortPosts(posts).map((post) => post.id)).toEqual([
      "a-post",
      "b-post",
      "z-post",
    ]);
    expect(posts.map((post) => post.id)).toEqual(["z-post", "b-post", "a-post"]);
  });

  it("groups sorted posts into stable Chinese month buckets", () => {
    const groups = groupPostsByMonth([
      { id: "december", publishedAt: new Date("2025-12-20T00:00:00Z") },
      { id: "january", publishedAt: new Date("2026-01-05T00:00:00Z") },
    ]);

    expect(groups).toEqual([
      {
        key: "2026-01",
        year: 2026,
        month: 1,
        label: "2026年1月",
        posts: [{ id: "january", publishedAt: new Date("2026-01-05T00:00:00Z") }],
      },
      {
        key: "2025-12",
        year: 2025,
        month: 12,
        label: "2025年12月",
        posts: [{ id: "december", publishedAt: new Date("2025-12-20T00:00:00Z") }],
      },
    ]);
  });
});
