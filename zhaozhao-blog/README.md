# 233昭个人博客

面向单博主长期维护的 Astro SSR 动态博客，运行于 Cloudflare Workers：

- D1：文章、项目、分类、友链、留言、后台会话和页面设置
- Workers KV：后台上传的头像、插画和内容图片
- Worker 静态资源：仓库内置头像与背景
- 单管理员后台：`/admin/`

仓库目标：[ZhaoJun233/zhaozhao-website](https://github.com/ZhaoJun233/zhaozhao-website)

## 本地开发

```powershell
npm ci
Copy-Item .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

- 前台：<http://127.0.0.1:4321/>
- 后台：<http://127.0.0.1:4321/admin/>
- 健康检查：<http://127.0.0.1:4321/api/health>

## 校验

```powershell
npm run cf:typegen
npm run check
npm test
npm run build
npm run test:e2e
```

内容操作见 [AUTHORING.md](AUTHORING.md)，部署步骤见 [Cloudflare 部署说明](docs/CLOUDFLARE-DEPLOYMENT.md)。
