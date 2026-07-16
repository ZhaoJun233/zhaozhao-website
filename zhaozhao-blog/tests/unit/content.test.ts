import { describe, expect, it } from "vitest";
import type { SchemaContext } from "astro/content/config";
import { z } from "astro/zod";
import { createPostSchema, createProjectSchema } from "../../src/content.config";
import { validatePostCoverPair } from "../../src/lib/authoring";
import {
  buildCategoryIndex,
  buildTaxonomyIndex,
  estimateReadingMinutes,
  getRelatedPosts,
  paginate,
  sortPostEntries,
  sortPosts,
} from "../../src/lib/content";
import { groupPostsByMonth } from "../../src/lib/date";

const schemaContext = {
  image: () =>
    z.object({
      src: z.string(),
      width: z.number(),
      height: z.number(),
      format: z.union([
        z.literal("png"),
        z.literal("jpg"),
        z.literal("jpeg"),
        z.literal("tiff"),
        z.literal("webp"),
        z.literal("gif"),
        z.literal("svg"),
        z.literal("avif"),
      ]),
    }),
} satisfies SchemaContext;

const postSchema = createPostSchema(schemaContext);
const projectSchema = createProjectSchema(schemaContext);
const validPost = {
  title: "文章标题",
  description: "文章摘要",
  publishedAt: "2026-07-15",
  tags: ["Astro"],
  category: "开发",
};
const validProject = {
  title: "项目标题",
  description: "项目摘要",
  date: "2026-07-15",
  status: "active" as const,
  tags: ["Astro"],
};
const invalidDateInputs = [null, true, false, "", " ", "not-a-date"] as const;

describe("content domain", () => {
  it("accepts date values and rejects invalid post publishedAt inputs", () => {
    expect(postSchema.parse(validPost).publishedAt).toEqual(new Date("2026-07-15"));
    expect(
      postSchema.safeParse({ ...validPost, publishedAt: new Date("2026-07-15") }).success,
    ).toBe(true);

    for (const publishedAt of invalidDateInputs) {
      expect(postSchema.safeParse({ ...validPost, publishedAt }).success).toBe(false);
    }
  });

  it("accepts optional date values and rejects invalid post updatedAt inputs", () => {
    expect(postSchema.safeParse(validPost).success).toBe(true);
    expect(postSchema.parse({ ...validPost, updatedAt: "2026-07-16" }).updatedAt).toEqual(
      new Date("2026-07-16"),
    );
    expect(
      postSchema.safeParse({ ...validPost, updatedAt: new Date("2026-07-16") }).success,
    ).toBe(true);

    for (const updatedAt of invalidDateInputs) {
      expect(postSchema.safeParse({ ...validPost, updatedAt }).success).toBe(false);
    }
  });

  it("accepts date values and rejects invalid project date inputs", () => {
    expect(projectSchema.parse(validProject).date).toEqual(new Date("2026-07-15"));
    expect(
      projectSchema.safeParse({ ...validProject, date: new Date("2026-07-15") }).success,
    ).toBe(true);

    for (const date of invalidDateInputs) {
      expect(projectSchema.safeParse({ ...validProject, date }).success).toBe(false);
    }
  });

  it("accepts HTTP links and rejects executable or non-web URL schemes", () => {
    for (const url of ["https://example.com/path", "http://localhost:4321/"]) {
      expect(postSchema.safeParse({ ...validPost, canonicalUrl: url }).success).toBe(true);
      expect(projectSchema.safeParse({ ...validProject, repositoryUrl: url }).success).toBe(true);
      expect(projectSchema.safeParse({ ...validProject, demoUrl: url }).success).toBe(true);
    }

    for (const url of ["javascript:alert(1)", "data:text/html,hello", "ftp://example.com/file"]) {
      expect(postSchema.safeParse({ ...validPost, canonicalUrl: url }).success).toBe(false);
      expect(projectSchema.safeParse({ ...validProject, repositoryUrl: url }).success).toBe(false);
      expect(projectSchema.safeParse({ ...validProject, demoUrl: url }).success).toBe(false);
    }
  });

  it("requires CMS-authored cover images and descriptions as a pair", () => {
    expect(() => validatePostCoverPair(undefined, undefined)).not.toThrow();
    expect(() => validatePostCoverPair("/cover.jpg", "封面说明")).not.toThrow();
    expect(() => validatePostCoverPair("/cover.jpg", "")).toThrow(/同时填写/);
    expect(() => validatePostCoverPair(undefined, "封面说明")).toThrow(/同时填写/);
  });

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

  it("returns items 9 through 16 on the second eight-item page", () => {
    expect(paginate(Array.from({ length: 17 }, (_, index) => index + 1), 2, 8)).toEqual({
      items: [9, 10, 11, 12, 13, 14, 15, 16],
      page: 2,
      pageCount: 3,
      total: 17,
    });
  });

  it("throws RangeError for invalid pagination ranges", () => {
    expect(() => paginate([1, 2, 3], 0, 2)).toThrow(RangeError);
    expect(() => paginate([1, 2, 3], 1, 0)).toThrow(RangeError);
    expect(() => paginate([1, 2, 3], 3, 2)).toThrow(RangeError);
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

  it("adds a related-post point for the same series", () => {
    const current = {
      id: "current",
      publishedAt: new Date("2026-07-15"),
      category: "开发",
      tags: [],
      series: "Astro 入门",
    };
    const related = getRelatedPosts(
      current,
      [
        {
          id: "unrelated",
          publishedAt: new Date("2026-07-14"),
          category: "随笔",
          tags: [],
        },
        {
          id: "same-series",
          publishedAt: new Date("2026-07-13"),
          category: "随笔",
          tags: [],
          series: "Astro 入门",
        },
      ],
      2,
    );

    expect(related.map((item) => item.id)).toEqual(["same-series", "unrelated"]);
  });

  it("scores two points for each shared tag", () => {
    const current = {
      id: "current",
      publishedAt: new Date("2026-07-15"),
      category: "开发",
      tags: ["Astro", "TypeScript"],
    };
    const related = getRelatedPosts(
      current,
      [
        {
          id: "same-category",
          publishedAt: new Date("2026-07-14"),
          category: "开发",
          tags: [],
        },
        {
          id: "two-tags",
          publishedAt: new Date("2026-07-13"),
          category: "随笔",
          tags: ["Astro", "TypeScript"],
        },
      ],
      2,
    );

    expect(related.map((item) => item.id)).toEqual(["two-tags", "same-category"]);
  });

  it("excludes the current post from related results", () => {
    const current = {
      id: "current",
      publishedAt: new Date("2026-07-15"),
      category: "开发",
      tags: ["Astro"],
    };
    const related = getRelatedPosts(
      current,
      [
        current,
        {
          id: "other",
          publishedAt: new Date("2026-07-14"),
          category: "开发",
          tags: ["Astro"],
        },
      ],
      2,
    );

    expect(related.map((item) => item.id)).toEqual(["other"]);
  });

  it("breaks related-score ties by date descending then slug ascending", () => {
    const current = {
      id: "current",
      publishedAt: new Date("2026-07-15"),
      category: "开发",
      tags: [],
    };
    const related = getRelatedPosts(
      current,
      [
        {
          id: "old",
          publishedAt: new Date("2026-07-12"),
          category: "开发",
          tags: [],
        },
        {
          id: "z-new",
          publishedAt: new Date("2026-07-14"),
          category: "开发",
          tags: [],
        },
        {
          id: "a-new",
          publishedAt: new Date("2026-07-14"),
          category: "开发",
          tags: [],
        },
      ],
      3,
    );

    expect(related.map((item) => item.id)).toEqual(["a-new", "z-new", "old"]);
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

  it("sorts collection-style post entries without mutating them", () => {
    const posts = [
      { id: "older", data: { publishedAt: new Date("2026-07-14") } },
      { id: "newer", data: { publishedAt: new Date("2026-07-15") } },
    ];

    expect(sortPostEntries(posts).map((post) => post.id)).toEqual(["newer", "older"]);
    expect(posts.map((post) => post.id)).toEqual(["older", "newer"]);
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

  it("keeps December 2025 and January 2026 in separate Chinese month groups", () => {
    const groups = groupPostsByMonth([
      { id: "december", publishedAt: new Date("2025-12-31T15:59:59Z") },
      { id: "january", publishedAt: new Date("2025-12-31T16:00:00Z") },
    ]);

    expect(groups.map(({ key, label }) => ({ key, label }))).toEqual([
      { key: "2026-01", label: "2026年1月" },
      { key: "2025-12", label: "2025年12月" },
    ]);
  });

  it("names both original values when taxonomy slugs collide", () => {
    expect(() => buildTaxonomyIndex(["Astro CSS", "Astro / CSS"])).toThrow(
      /Astro CSS.*Astro \/ CSS/,
    );
  });

  it("keeps managed category order and includes empty or legacy categories", () => {
    expect(
      buildCategoryIndex(
        [
          { name: "动画", description: "观看记录" },
          { name: "开发", description: "代码实践" },
          { name: "新分类", description: "待发布" },
        ],
        ["开发", "开发", "动画", "旧分类"],
        { includeUnmanaged: true },
      ),
    ).toEqual([
      { label: "动画", slug: "动画", count: 1, description: "观看记录" },
      { label: "开发", slug: "开发", count: 2, description: "代码实践" },
      { label: "新分类", slug: "新分类", count: 0, description: "待发布" },
      { label: "旧分类", slug: "旧分类", count: 1 },
    ]);
  });

  it("treats the managed category list as authoritative for discovery", () => {
    expect(
      buildCategoryIndex(
        [{ name: "开发", description: "代码实践" }],
        ["开发", "已删除分类"],
      ),
    ).toEqual([
      { label: "开发", slug: "开发", count: 1, description: "代码实践" },
    ]);
  });
});
