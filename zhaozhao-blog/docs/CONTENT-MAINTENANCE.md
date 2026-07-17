# 内容维护说明

## 登录后台

访问 `/admin/`，输入 Cloudflare Secret `ADMIN_PASSWORD`。后台只有一个管理员账号；修改 `ADMIN_SESSION_SECRET` 会让现有登录立即失效。

## 日常维护

1. 在对应模块修改内容并保存。
2. 刷新前台确认结果。
3. 进行大批量编辑前，在“数据与备份”下载完整 JSON。
4. 图片通过页面内容编辑器上传到 Workers KV，再保存返回的媒体路径。

分类仍被文章引用时会阻止删除；分类改名会在同一次 D1 批处理中同步文章。友链排序必须提交完整列表。留言邮箱仅在后台显示。

## 备份与恢复

后台导出的 JSON 包含页面设置、分类、文章、项目、友链和留言。导入前会先校验全部内容，再通过单次 D1 批处理替换数据；失败时不会保留半份内容。

建议：

- 每次重要发布前下载 JSON。
- 定期使用 Cloudflare D1 导出能力保存远程副本。
- KV 媒体单独保留键值清单或生命周期备份。
- 回滚代码时同时确认迁移版本和 JSON 数据版本。

## 本地维护

```powershell
Copy-Item .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

浏览器访问 `/rss.xml` 会显示可读的订阅页，阅读器仍可识别标准 RSS 2.0 内容。
