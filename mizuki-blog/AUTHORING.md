# 内容维护与发布

本站以 Markdown/JSON 作为唯一内容源。Decap CMS 写入仓库文件，`builder` 监听 `src/` 与 `public/`，保存后自动生成包含 Pagefind 索引的新版本。构建完成后通过原子链接切换到 Nginx；构建失败时继续提供上一版本，避免半成品页面上线。

## Docker 运行

```bash
docker compose up -d --build --wait
```

- 博客与后台：<http://127.0.0.1:4321/>、<http://127.0.0.1:4321/admin/>
- Decap 本地代理：<http://127.0.0.1:8081/api/v1>
- 构建日志：`docker compose logs -f builder`

进入后台后点击“登录”。保存文章、项目、博主资料或分类后，构建器通常会在数秒内发布新版本；浏览器刷新即可看到变化。三个服务均只绑定本机或 Compose 内部网络：

- `cms`：只写文章、项目、资料与上传目录。
- `builder`：只读内容源，向 `site-data` 发布完整版本并保留最近三个版本。
- `site`：以只读方式挂载 `site-data`，只负责提供静态页面。

分类列表是前台分类索引的权威来源。删除仍被文章引用的分类后，它会从分类索引隐藏，但旧文章详情链接继续可用；建议随后在文章编辑器中重新选择分类。

停止服务：

```bash
docker compose down
```

删除发布缓存并从头构建：

```bash
docker compose down -v
docker compose up -d --build --wait
```

## 本机写作

```bash
npm ci
npm run author
```

本机模式同样使用 <http://127.0.0.1:4321/> 和 <http://127.0.0.1:8081/api/v1>，由 Astro 开发服务器热更新。

## 校验

```bash
npm run validate:authoring
npm test
npm run check
npm run build
npm run test:a11y
npm run audit:lighthouse
docker compose config
```

## 不可变生产镜像

正式发布到远程环境时，可继续构建不含 CMS 和源码挂载的静态镜像：

```bash
docker build --target production \
  --build-arg PUBLIC_SITE_URL=https://example.com \
  -t mizuki-blog:latest .
```

头像路径由 `src/data/profile.json` 管理，分类由 `src/data/taxonomy.json` 管理。提交前使用 `git diff` 审核后台写入的内容变更。
