# Cloudflare 原生部署

部署目标为 Cloudflare Workers，数据使用 D1，后台上传媒体使用 R2。GitHub 仓库为 `ZhaoJun233/zhaozhao-website`，生产分支为 `master`。

## 1. 创建资源

在已登录 Wrangler 的终端执行：

```powershell
npx wrangler d1 create zhaozhao-blog
npx wrangler r2 bucket create zhaozhao-media
```

D1 创建命令会返回真实 `database_id`。将它复制到 `wrangler.jsonc` 的 `d1_databases[0].database_id`，替换当前本地占位值，然后提交该配置。

绑定名称保持固定：

- D1：`DB`
- R2：`MEDIA`
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
npm run db:migrate:remote
npm run deploy
```

首次远程迁移会建立结构并导入仓库种子内容。部署完成后检查首页、`/admin/`、`/rss.xml`、留言和图片上传。

## 4. 现有数据切换

1. 从旧站后台“数据与备份”下载完整 JSON。
2. 完成远程迁移和 Worker 部署。
3. 登录新站后台“数据与备份”。
4. 导入 JSON，并核对文章、项目、分类、友链、页面设置和留言数量。
5. 上传旧 JSON 中引用但未进入静态资源或 R2 的图片，并更新对应路径。
6. 验证完成后再切换域名。

## 5. GitHub 连接

Cloudflare Workers Builds 可连接 `ZhaoJun233/zhaozhao-website`：

- Production branch：`master`
- Build command：`npm run build`
- Deploy command：`npx wrangler deploy`
- Root directory：`zhaozhao-blog`
- Node.js：使用 Cloudflare 当前受支持的 LTS 版本

在 Cloudflare 项目设置中确认 D1、R2 绑定和两个管理员 Secrets 已存在。

## 6. 自定义域名

在 Worker 的 Domains & Routes 中添加域名，将 `PUBLIC_SITE_URL` 更新为最终 HTTPS 地址后重新部署。随后检查 canonical、sitemap、robots、RSS 和 Web App Manifest 中的域名。

## 7. 备份和回滚

- 内容回滚：在后台导入部署前保存的 JSON。
- 代码回滚：重新部署 Git 历史中的稳定提交。
- D1 结构回滚：优先新增修复迁移，不修改已执行的迁移文件。
- R2 回滚：恢复对象或把页面设置改回已有媒体路径。

发布前可执行：

```powershell
npm run build
npx wrangler deploy --dry-run
```

远程操作前再次确认 `database_id`、Worker 名称、生产分支和目标账号。
