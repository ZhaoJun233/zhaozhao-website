import { describe, expect, it } from "vitest";
import {
  buildMarkdownImportPreview,
  findRelativeMarkdownImages,
  parseMarkdownPostImport,
} from "../../src/lib/admin/markdown-import";

describe("Markdown article import", () => {
  it("finds relative Markdown images in source order", () => {
    expect(findRelativeMarkdownImages([
      "![本地](./images/local.png)",
      "![另一个](../shared/cover.webp)",
      "![重复](./images/local.png)",
      "![本站](/media/uploads/2026/07/a.webp)",
      "![外部](https://images.example/a.webp)",
    ].join("\n"))).toEqual(["./images/local.png", "../shared/cover.webp"]);
  });

  it("builds an editor preview without creating a post", () => {
    const now = new Date("2026-07-17T08:00:00.000Z");
    const source = `---
title: 导入预览
description: 导入文章的编辑器预览。
category: 开发
tags:
  - Astro
---

![本地](./images/local.png)
`;

    const preview = buildMarkdownImportPreview("hello.md", source, now);

    expect(preview).toEqual({
      post: expect.objectContaining({ slug: "hello", draft: true }),
      relativeImages: ["./images/local.png"],
    });
  });

  it("maps standard frontmatter and defaults a new import to draft", () => {
    const post = parseMarkdownPostImport("my-first-post.md", `---
title: 第一篇导入文章
description: 从 Markdown 文件导入的文章摘要。
publishedAt: 2026-07-16
category: 开发
tags:
  - Astro
  - 写作
---

这里是正文。
`);

    expect(post).toMatchObject({
      slug: "my-first-post",
      title: "第一篇导入文章",
      description: "从 Markdown 文件导入的文章摘要。",
      category: "开发",
      tags: ["Astro", "写作"],
      draft: true,
      body: "\n这里是正文。\n",
    });
    expect(new Date(String(post.publishedAt)).toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });

  it("supports common aliases and comma-separated tags", () => {
    const post = parseMarkdownPostImport("ignored.markdown", `---
slug: imported-aliases
title: 字段别名
description: 兼容常见 Markdown frontmatter。
date: 2026-07-15
updated: 2026-07-16
category: 生活
tags: 动画, 随笔
draft: false
canonical: https://example.com/imported-aliases
---
正文内容。
`);

    expect(post).toMatchObject({
      slug: "imported-aliases",
      tags: ["动画", "随笔"],
      draft: false,
      canonicalUrl: "https://example.com/imported-aliases",
    });
    expect(new Date(String(post.updatedAt)).toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });

  it("rejects unsupported files and oversized Markdown", () => {
    expect(() => parseMarkdownPostImport("post.txt", "plain text"))
      .toThrow("只支持 .md 或 .markdown 文件");
    expect(() => parseMarkdownPostImport("post.md", "x".repeat(2 * 1024 * 1024 + 1)))
      .toThrow("不能超过 2 MiB");
  });
});
