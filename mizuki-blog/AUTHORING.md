# 本地内容编辑

Decap CMS 会直接修改当前工作区里的文章、项目和 `src/data/profile.json`；Astro 开发服务器会随文件保存自动热更新。本机方式使用 Node.js 24。

## 本机运行

```bash
npm ci
npm run author
```

- 博客与后台：<http://localhost:4321/>、<http://localhost:4321/admin/>
- Decap 本地代理：<http://localhost:8081/api/v1>

进入后台后点击“登录”，Decap 会自动连接本地代理，不需要单独的账号。

## Docker Compose

```bash
docker compose up --build
```

Compose 将仓库根目录绑定到容器的 `/workspace`，因此后台保存的内容会保留在宿主机工作区；博客容器启用了轮询监听，保存后会热更新。停止服务使用 `docker compose down`，保留的 `blog_node_modules` 卷可用 `docker compose down -v` 一并清理。

## 校验与发布构建

```bash
npm run validate:authoring
npm test
npm run check
npm run build
docker compose config
```

头像路径由 `src/data/profile.json` 统一配置，后台上传的头像保存在 `src/assets/profile/`。提交前请用 `git diff` 检查 Decap 写入的工作区变更。
