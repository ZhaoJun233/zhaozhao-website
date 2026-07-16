# 内容维护与发布

本站使用 Astro SSR、SQLite 与单管理员后台。运行时数据库是文章、项目、分类、友链、留言和页面设置的权威内容源，后台保存后刷新前台即可生效。

## 本地运行

```powershell
npm ci
npm run dev
```

Docker 部署：

```powershell
docker compose up -d --build --remove-orphans
```

- 博客：<http://127.0.0.1:4321/>
- 后台：<http://127.0.0.1:4321/admin/>
- 健康检查：<http://127.0.0.1:4321/api/health>

## 后台维护

- “文章”支持表单编辑及 `.md`、`.markdown` 文件直接导入。
- “页面内容 > 个人资料”维护昵称、站点信息、头像、职业、所在地、个性签名、邮箱和个人网站。
- “数据与备份”导出或恢复完整 JSON 数据。
- SQLite 文件位于容器 `/app/storage/blog.sqlite`，由 `zhaozhao-blog_blog-data` 命名卷持久化。

停止容器时保留数据库：

```powershell
docker compose down
```

## 发布前校验

```powershell
npm run check
npm test
npm run build
npm run test:e2e
docker compose config
```

更完整的数据库备份、恢复与 Markdown frontmatter 格式参见 `docs/CONTENT-MAINTENANCE.md`。
