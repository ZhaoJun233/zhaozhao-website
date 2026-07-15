# 本地内容编辑

Decap CMS 会直接修改当前工作区里的文章、项目和 `src/data/profile.json`；Astro 开发服务器会随文件保存自动热更新。本机方式使用 Node.js 24。

## 本机运行

```bash
npm ci
npm run author
```

- 博客与后台：<http://127.0.0.1:4322/>、<http://127.0.0.1:4322/admin/>
- Decap 本地代理：<http://127.0.0.1:8081/api/v1>

进入后台后点击“登录”，Decap 会自动连接本地代理，不需要单独的账号。

## Docker Compose

生产预览使用构建后的静态站点，包含 Pagefind 全文搜索，不暴露 Astro 开发端点：

```bash
docker compose up -d --build
```

- 生产预览：<http://127.0.0.1:4321/>
- 只有静态产物进入运行镜像，服务仅绑定本机回环地址。

需要在 Docker 中编辑内容时，启动写作 profile：

```bash
docker compose --profile authoring up -d --build
```

- 实时博客与后台：<http://127.0.0.1:4322/>、<http://127.0.0.1:4322/admin/>
- Decap 本地代理：<http://127.0.0.1:8081/api/v1>

实时博客只绑定 `src/` 和 `public/`；CMS 仅可写文章、项目、博主资料与上传目录。后台保存会保留在宿主机并触发 Astro 热更新。代理只绑定本机，并仅接受来自 `http://127.0.0.1:4322` 的浏览器请求。编辑完成后执行 `docker compose up -d --build site` 刷新生产预览；停止全部服务使用 `docker compose --profile authoring down`。

## 校验与发布构建

```bash
npm run validate:authoring
npm test
npm run check
npm run build
npm run test:a11y
npm run audit:lighthouse
docker compose config
```

头像路径由 `src/data/profile.json` 统一配置，后台上传的头像保存在 `src/assets/profile/`。提交前请用 `git diff` 检查 Decap 写入的工作区变更。
