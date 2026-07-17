# 内容维护与发布

后台保存后，前台下一次请求即从 D1 读取最新内容，不需要重新构建。

## 后台模块

- **文章**：新增、编辑、删除、草稿、精选、分类、标签、封面和 Markdown 文件导入。
- **项目**：维护正文、状态、标签、仓库地址、演示地址和精选状态。
- **分类**：新增、改名、启停和删除；改名同步更新引用文章。
- **友链**：新增、编辑、启停、删除和排序。
- **留言**：审核、公开、隐藏、退回待审或删除。
- **页面内容**：维护个人资料、导航、首页、关于、友链、留言、鸣谢、索引文案和插画信息。
- **数据与备份**：导出或恢复完整 JSON。

个人资料和插画路径旁提供图片上传控件。上传成功后会得到 `/media/uploads/...` 路径；保存当前区域后前台生效。

## Markdown 导入

后台“文章”可导入不超过 2 MiB 的 `.md` 或 `.markdown` 文件。未填写 `draft` 时默认保存为草稿。

```markdown
---
title: 文章标题
description: 文章摘要
publishedAt: 2026-07-17
category: 开发
tags: Astro, Cloudflare
---

这里是正文。
```

Slug 默认取英文文件名，也可在 frontmatter 中填写 `slug`。重复 Slug 或校验失败时不会写入。

## 发布前校验

```powershell
npm run cf:typegen
npm run check
npm test
npm run build
npm run test:e2e
```

资源创建、远程迁移、域名切换和回滚见 `docs/CLOUDFLARE-DEPLOYMENT.md`。
