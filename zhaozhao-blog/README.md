# 233昭个人博客

基于 Astro SSR、SQLite 和 Docker 的单博主动态网站。

## 启动

```powershell
Copy-Item .env.example .env
docker compose up -d --build
```

- 前台：`http://127.0.0.1:4321/`
- 后台：`http://127.0.0.1:4321/admin/`
- 健康检查：`http://127.0.0.1:4321/api/health`

首次启动会把仓库现有内容导入 SQLite。后续内容维护、访客留言审核和备份恢复均在后台完成。

详细操作见 [内容维护说明](docs/CONTENT-MAINTENANCE.md)。
