---
title: "用 Astro Content Collections 整理个人写作"
description: "从字段约束、稳定路径到构建校验，记录一次小型 Astro 内容系统的整理过程。"
publishedAt: 2026-07-12
draft: false
tags:
  - Astro
  - TypeScript
  - 内容管理
category: 开发
featured: true
series: 博客开发笔记
---

个人博客写久以后，最先变乱的往往不是样式，而是内容：日期有几种写法，标签大小写不一致，封面有时忘记替代文字。Astro 的 Content Collections 适合把这些约定放进代码，让 Markdown 继续保持轻便，同时在构建阶段尽早暴露问题。下面的字段与文章只是本站的**演示样例**，用于说明方法，并不代表一套必须照搬的生产配置。

## 先把约定写成结构

我只保留页面真正会使用的字段，并让必填项保持少而清楚：

- `title` 与 `description` 服务列表页和搜索结果；
- `publishedAt` 决定归档与排序，`draft` 控制发布状态；
- `category` 只选一个，`tags` 用来描述多个侧面；
- 封面可选，但一旦提供，就必须同时写出有意义的替代文字。

一个精简的示意 schema 可以这样写：

```ts
const post = z.object({
  title: z.string().trim().min(1),
  publishedAt: z.coerce.date(),
  draft: z.boolean().default(false),
  tags: z.array(z.string()).min(1).max(8),
  category: z.string().trim().min(1),
});
```

## 让文件路径承担身份

文章文件名就是稳定 slug，例如 `astro-content-collections.md` 对应固定详情路径。标题可以微调，链接却不会跟着漂移。分类页、标签页和年份归档都从同一份集合数据派生，不再维护容易过期的手写索引。具体加载方式可参考 [Astro Content Collections 文档](https://docs.astro.build/zh-cn/guides/content-collections/)。

## 把错误留在发布之前

现在每次提交前，我会依次检查三件事：schema 是否通过、草稿是否被过滤、文章链接是否能由 slug 找到。标签还会先做 Unicode 规范化再去重，避免全角字符或多余空格制造两个看似相同的入口。

我也刻意不在 frontmatter 里保存阅读时长、相关文章或归档月份。这些信息都能从正文、分类和发布日期计算出来；重复写入只会让作者在修改后多一处需要同步。内容文件负责表达事实，派生数据交给统一函数生成，边界因此更容易理解和测试。

这种整理不会替作者决定写什么，却能减少写作之外的犹豫。新建文章时，我只需复制一份最小 frontmatter，剩下的排序、聚合与校验交给构建流程。工具安静地守住边界，正文才有更多空间留给真正想说的话。
