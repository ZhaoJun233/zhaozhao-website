# 内容维护说明

博客使用 Astro SSR 与 SQLite。文章、项目、分类、友链、访客留言和所有页面设置都由同一个数据库管理，后台保存后刷新前台即可看到结果。

## 登录后台

1. 访问 `http://127.0.0.1:4321/admin/`。
2. 输入 Docker 环境变量 `ADMIN_PASSWORD` 的值。
3. 当前 Docker 本地默认密码为 `233zhao-local-admin`，公开部署前必须在 `.env` 中修改。

后台模块包括：概览、文章、项目、分类、友链、留言、页面内容、数据与备份。

## 日常维护

- **文章**：新增、修改、删除、草稿、精选、正文、分类、标签、封面和发布日期。
- **项目**：维护正文、状态、外部链接、标签和精选状态。
- **分类**：新增、改名、启停和删除；改名会同步更新引用文章。
- **友链**：新增、编辑、删除、启停、上移和下移。
- **留言**：访客提交后默认为待审核；后台可公开、退回待审、隐藏或删除。邮箱只在后台展示。
- **页面内容**：维护个人资料、导航、首页、关于、友链页文案、留言页文案、鸣谢、索引页文案和插画信息。

## Docker 数据持久化

生产数据库路径为 `/app/storage/blog.sqlite`，保存在 Compose 命名卷 `zhaozhao-blog_blog-data` 中。执行 `docker compose up -d --build` 或重建容器不会删除该卷。

查看卷：

```powershell
docker volume inspect zhaozhao-blog_blog-data
```

只停止服务：

```powershell
docker compose down
```

不要使用 `docker compose down -v`，该命令会同时删除数据库卷。

## 备份与恢复

后台“数据与备份”可以下载全量 JSON，内容包括页面设置、文章、项目、分类、友链和访客留言。导入时会先完整校验，再在单个数据库事务中替换内容；校验失败不会留下半份数据。

数据库文件级备份应在停止站点写入后执行。恢复数据库文件后重新启动容器即可。

## 首次迁移

数据库为空时，应用自动导入现有 `src/data/*.json`、`src/content/posts/*.md` 和 `src/content/projects/*.md`。迁移成功后写入版本记录，后续启动不会用文件覆盖后台修改。

## 环境变量

```dotenv
BLOG_DATABASE_PATH=/app/storage/blog.sqlite
ADMIN_PASSWORD=使用独立强密码
ADMIN_SESSION_SECRET=使用长度足够的随机字符串
```

修改密码或会话密钥后执行 `docker compose up -d`。修改会话密钥会使现有后台登录失效，需要重新登录。

## 发布前检查

```powershell
npm run check
npm test
npm run build
docker compose up -d --build --remove-orphans
```

浏览器访问 `/rss.xml` 会显示可读的订阅页；RSS 阅读器仍将其识别为标准 RSS 2.0 XML。
