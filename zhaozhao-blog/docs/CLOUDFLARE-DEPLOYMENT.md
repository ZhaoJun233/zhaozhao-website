# Cloudflare 原生部署

部署目标为 Cloudflare Workers，数据使用 D1，后台上传媒体使用 Workers KV。GitHub 仓库为 `ZhaoJun233/zhaozhao-website`，生产分支为 `master`。

## 1. 创建资源

在已登录 Wrangler 的终端执行：

```powershell
npx wrangler d1 create zhaozhao-blog
npx wrangler kv namespace create zhaozhao-media
```

D1 创建命令会返回真实 `database_id`，KV 创建命令会返回真实命名空间 `id`。将它们分别写入 `wrangler.jsonc` 的 D1 与 KV 配置，然后提交。

绑定名称保持固定：

- D1：`DB`
- KV：`MEDIA`
- Worker：`zhaozhao-website`

## 2. 设置管理员 Secrets

```powershell
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put ADMIN_SESSION_SECRET
```

密码使用独立强密码；会话密钥使用足够长的随机值。Secret 只保存在 Cloudflare，不提交到 Git。

## 3. 迁移和部署

```powershell
npm ci
npm run cf:typegen
npm run check
npm test
npm run build
npm run test:e2e
npx wrangler deploy --dry-run
npm run db:migrate:remote
npm run deploy
```

`wrangler deploy --dry-run` 应列出 D1 绑定 `DB` 和 KV 绑定 `MEDIA`。首次远程迁移会建立结构并导入仓库种子内容；已有环境会应用 `0004_post_media.sql`，创建文章媒体、引用关系和清理队列表。远程迁移与部署都应在本地验证和变更审查通过后执行。

部署完成后先做基础烟雾检查：

```text
GET  /                       -> 200
GET  /admin/posts/           -> 302（无会话），200（已登录）
POST /api/admin/post-assets/ -> 401（无会话）
GET  /rss.xml                -> 200
```

随后登录后台并打开一次 `/admin/posts/`，触发可重复执行的旧文章媒体回填，再按以下顺序验证共享引用与最终清理：

1. 创建文章 A，上传一张封面和一张正文图片，保存后确认两个 `/media/uploads/.../` 地址均返回 200。
2. 创建文章 B，在 Markdown 中复用文章 A 的正文图片 URL 并保存。
3. 删除文章 A，确认预览显示 1 张共享图片；删除后封面最终返回 404，而复用的正文图片仍返回 200。
4. 删除文章 B，使用带随机查询参数的正文图片 URL 轮询，确认最后一个引用移除后最终返回 404。
5. 用只读远程查询确认没有遗留清理任务：

```powershell
npx wrangler d1 execute zhaozhao-blog --remote --command "SELECT COUNT(*) AS cleanup_pending FROM media_cleanup_jobs;"
```

预期 `cleanup_pending` 为 `0`。若大于 `0`，先保留现场并检查 `attempts` 与 `last_error`，不要直接修改远程表。

## 4. 现有数据切换

1. 从旧站后台“数据与备份”下载 v2 JSON，并单独备份 Workers KV 图片对象。
2. 完成远程迁移和 Worker 部署。
3. 登录新站后台“数据与备份”。
4. 导入 JSON，并核对文章、项目、分类、友链、页面设置和留言数量。
5. 恢复 KV 对象；对旧 JSON 中引用但未进入静态资源或 KV 的图片重新上传并更新对应路径。
6. 验证完成后再切换域名。

## 5. GitHub 连接

Cloudflare Workers Builds 可连接 `ZhaoJun233/zhaozhao-website`：

- Production branch：`master`
- Build command：`npm run build`
- Deploy command：`npx wrangler deploy`
- Root directory：`zhaozhao-blog`
- Node.js：使用 Cloudflare 当前受支持的 LTS 版本

在 Cloudflare 项目设置中确认 D1、KV 绑定和两个管理员 Secrets 已存在。

## 6. 自定义域名

在 Worker 的 Domains & Routes 中添加域名，将 `PUBLIC_SITE_URL` 更新为最终 HTTPS 地址后重新部署。随后检查 canonical、sitemap、robots、RSS 和 Web App Manifest 中的域名。

## 7. 备份和回滚

- 内容回滚：在后台导入部署前保存的 JSON。
- 代码回滚：重新部署 Git 历史中的稳定提交。
- D1 结构回滚：优先新增修复迁移，不修改已执行的迁移文件。
- KV 回滚：恢复键值对象或把页面设置改回已有媒体路径。

注意：v2 JSON 只保存媒体元数据和引用关系，不含 KV 二进制对象。只有 JSON 的回滚不构成完整图片恢复。

发布前可执行：

```powershell
npm run build
npx wrangler deploy --dry-run
```

远程操作前再次确认 D1 `database_id`、KV `id`、Worker 名称、生产分支和目标账号。
