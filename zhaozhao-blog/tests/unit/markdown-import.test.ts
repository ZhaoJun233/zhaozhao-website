import { describe, expect, it } from "vitest";
import { parseMarkdownPostImport } from "../../src/lib/admin/markdown-import";

describe("Markdown article import", () => {
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
