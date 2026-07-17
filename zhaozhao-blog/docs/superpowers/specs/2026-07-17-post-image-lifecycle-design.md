# 文章图片上传与生命周期设计

**日期：** 2026-07-17  
**状态：** 已确认，实施计划已编写
**适用项目：** `zhaozhao-blog`

## 1. 目标

把后台文章编辑从“手填图片路径”升级为可直接管理图片的工作流：

- 新建或编辑文章时直接上传封面与正文图片；
- 在 Markdown 光标位置插入已上传图片；
- 展示“本文图片”列表及图片用途；
- 同一图片允许被多篇文章复用；
- 删除文章时删除该文章独占的图片，继续保留共享图片；
- 对 D1 与 Workers KV 之间的清理失败保留可重试记录；
- Markdown 导入先进入编辑表单预览，再由博主补充图片并保存。

本期仅支持图片，不加入 PDF、ZIP、音频、视频或其他附件类型。

## 2. 当前问题

现有 `posts` 表只保存封面路径和 Markdown 字符串。后台封面字段是普通文本框，媒体上传接口只把图片写入 KV，没有文章所有权、引用关系或图片清单。删除文章只删除 D1 文章记录，因此会遗留 KV 图片，也无法判断图片是否被其他文章使用。

Markdown 导入当前会立即创建文章，并且不会处理本地图片。新流程需要先把导入结果填入编辑器，让博主检查内容、上传图片并确认保存。

## 3. 范围

### 3.1 包含

- JPEG、PNG、WebP、GIF 图片上传；
- 单张图片最大 5 MiB；
- 封面上传、替换、预览、移除和替代文字；
- 正文多图上传及 Markdown 插入；
- 文章图片清单、共享状态、复制链接和删除操作；
- 新文章保存前的临时图片；
- 文章保存时同步图片引用；
- 删除文章时清理独占图片；
- KV 删除失败后的重试队列；
- JSON 备份中的图片清单和引用元数据；
- 相关单元、Workers 和浏览器测试。

### 3.2 不包含

- 图片裁剪、滤镜和在线编辑；
- 自动压缩或自动转换图片格式；
- SVG、HTML 或其他同源可执行内容；
- 面向访客的公开媒体库；
- 项目、个人资料和页面设置的统一媒体库改造；
- 在 JSON 备份中嵌入图片二进制数据。

现有页面设置图片继续使用 `/api/admin/media/`，保持现有行为。本设计新增文章专用图片接口，不改变页面设置上传协议。

## 4. 用户体验

### 4.1 新建文章

点击“新建文章”后，浏览器使用 `crypto.randomUUID()` 生成不可预测的 `draftToken`，并显示空白编辑表单。标题输入后自动生成 Slug；用户手动修改 Slug 后停止自动覆盖。

编辑器分为以下区域：

1. **基本信息**：标题、Slug、摘要、分类、标签、发布日期、更新日期、系列、规范链接、草稿和首页精选。
2. **封面图片**：拖拽或选择本地图片，显示预览、文件名和大小；可替换、移除并填写封面说明。
3. **Markdown 正文**：保留文本编辑器，增加“上传并插入图片”按钮，支持一次选择多张图片。
4. **本文图片**：显示缩略图、原文件名、大小、用途及共享状态，并提供“设为封面”“插入正文”“复制链接”“从本文移除”。

通过文章专用接口上传成功后，正文插入标准 Markdown：

```markdown
![图片说明](/media/uploads/2026/07/{asset-key}.webp)
```

新文章保存前上传的图片带有 `draftToken`。文章创建成功后，服务端把这些图片绑定到新文章并清除临时标识。点击取消时立即为本次临时图片创建清理任务；超过 24 小时仍未保存的临时图片也会在后续后台媒体操作时进入清理队列。

### 4.2 编辑文章

打开文章时加载文章数据与图片清单。所有上传、封面和正文图片都必须同时拥有 `library` 引用；`cover` 与 `inline` 是附加用途。保存时服务端重新同步：

- 当前封面图片；
- Markdown 正文中的本站图片；
- 仍保留在“本文图片”中的上传图片。

从正文删除 Markdown 图片后只移除 `inline` 用途，`library` 引用继续保留，因此图片仍显示在“本文图片”中。只有博主明确从本文移除图片，且该图片不再是封面、正文图片或其他文章的图片时，图片才进入清理队列。

### 4.3 共享图片

把已有本站图片链接插入另一篇文章并保存时，服务端识别 KV 路径，同时建立 `library` 与 `inline` 引用。图片列表中的“被 N 篇文章使用”表示除当前文章外，仍有 N 篇不同文章引用该图片。共享图片不可直接物理删除，只能从当前文章解除关联。

### 4.4 删除文章

删除前调用预览接口并显示：

```text
将删除文章《文章标题》
独占图片：3 张，将一并删除
共享图片：1 张，继续保留
```

确认后先原子提交 D1 文章删除、引用删除和独占图片清理任务，再尝试删除 KV 对象。单个 KV 删除失败不会恢复文章；任务保留并在后续管理操作中重试。

### 4.5 Markdown 导入

导入 `.md` 或 `.markdown` 后只填充编辑表单，不立即写入数据库。相对图片路径会标记为“待处理图片”，博主可上传对应图片并替换为本站路径。外部 HTTPS 图片链接保持原样。

## 5. 数据模型

新增迁移，不修改已在线执行的迁移语义。

### 5.1 `media_assets`

```sql
CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  kv_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER,
  state TEXT NOT NULL DEFAULT 'uploading'
    CHECK (state IN ('uploading', 'ready', 'pending_delete')),
  draft_token TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_media_assets_draft
  ON media_assets(draft_token, created_at);
```

`public_url` 不重复保存，统一由 `kv_key` 生成 `/media/{kv_key}`。

### 5.2 `post_asset_links`

```sql
CREATE TABLE post_asset_links (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  usage TEXT NOT NULL CHECK (usage IN ('library', 'cover', 'inline')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, asset_id, usage)
);

CREATE INDEX idx_post_asset_links_asset
  ON post_asset_links(asset_id);

CREATE UNIQUE INDEX idx_post_asset_one_cover
  ON post_asset_links(post_id)
  WHERE usage = 'cover';
```

`library` 表示图片仍属于“本文图片”；`cover` 与 `inline` 表示实际渲染用途。同一图片可以在同一文章中拥有多种用途，也可以关联多篇文章。部分唯一索引保证每篇文章最多只有一张封面。

### 5.3 `media_cleanup_jobs`

```sql
CREATE TABLE media_cleanup_jobs (
  asset_id TEXT PRIMARY KEY REFERENCES media_assets(id) ON DELETE CASCADE,
  kv_key TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL CHECK (
    reason IN (
      'article_delete', 'manual_remove', 'draft_cancelled', 'draft_expired',
      'upload_failed', 'backup_restore'
    )
  ),
  queued_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
```

## 6. 上传与引用同步

### 6.1 上传顺序

为降低 D1 与 KV 跨存储不一致：

1. D1 创建 `state='uploading'` 的资产记录并生成随机 KV key；
2. 把文件写入 KV；
3. D1 把资产更新为 `state='ready'`；若提供 `postId`，同一 D1 批次还会立即建立该文章的 `library` 引用；
4. 如果 KV 写入失败，删除 D1 资产记录；
5. 如果最终状态或文章引用更新失败，资产进入 `upload_failed` 清理流程；
6. 不带 `postId` 的临时上传必须带有与资产记录完全匹配的 `draftToken`。

原始文件名只用于后台显示，公开 URL 始终使用随机 key。服务端同时校验 MIME、扩展名、空文件和 5 MiB 上限。

### 6.2 保存文章

保存接口接收文章字段、`draftToken`、`coverAssetId` 和仍保留的图片 ID。对新文章，服务端逐项验证临时资产的 `draft_token` 与请求 token 完全一致，并在文章与引用的同一 D1 原子批次中清空 `draft_token`。服务端解析 Markdown 图片与 HTML `img` 的本站 `/media/uploads/` 地址，并只为 `state='ready'` 的已登记图片建立引用。

`posts.cover` 继续作为前台运行时和旧备份兼容的封面 URL 单一数据源。`coverAssetId` 是保存请求中的校验字段：服务端从资产 `kv_key` 派生 URL，在同一批次中更新 `posts.cover`、替换唯一的 `cover` 引用，并确保该资产存在 `library` 引用。移除封面时同时清空 `posts.cover`、`posts.cover_alt` 和 `cover` 引用。

文章和引用更新使用 D1 `batch()` 原子提交。所有 `cover` 和 `inline` 资产必须同时保留 `library` 引用。手工粘贴的外部 URL 不进入媒体表；手工粘贴的本站已登记图片 URL 会建立共享的 `library` 与 `inline` 引用。

## 7. 删除与清理一致性

D1 和 KV 没有跨存储事务。文章删除采用以下顺序：

1. 删除预览接口只展示当前估算结果，不参与实际删除决策；
2. DELETE 请求在同一 D1 原子批次的 SQL 中使用 `NOT EXISTS` 重新判断是否存在其他文章引用；
3. 同一批次把当时仍为独占的资产设为 `pending_delete`、写入清理任务并删除文章；
4. 外键级联删除目标文章的引用；
5. 逐个删除清理任务对应的 KV 对象；
6. 成功后删除 `media_assets`，由外键级联清理任务；
7. 失败后增加 `attempts` 并记录 `last_error`。

清理任务处理必须幂等。KV 对象已经不存在时视为成功。后台文章专用图片上传、文章保存和文章删除请求会顺带处理少量待清理任务，避免依赖额外服务器进程。

## 8. API

### 8.1 上传文章图片

```text
POST /api/admin/post-assets/
multipart/form-data: file, draftToken?, postId?
```

返回：

```json
{
  "data": {
    "asset": {
      "id": "{asset-id}",
      "url": "/media/uploads/2026/07/{asset-key}.webp",
      "originalName": "cover.webp",
      "contentType": "image/webp",
      "sizeBytes": 123456,
      "sharedBy": 0
    }
  }
}
```

`draftToken` 与 `postId` 必须且只能提供一个。现有 `/api/admin/media/` 保持页面设置图片上传用途，不应用此限制。

### 8.2 文章图片列表

```text
GET /api/admin/posts/:postId/assets/
```

### 8.3 从文章移除图片

```text
DELETE /api/admin/posts/:postId/assets/:assetId/
```

该接口只移除当前文章的 `library` 引用。如果图片仍是当前封面或仍出现在正文中，返回 409，并要求先从封面或正文移除后保存。其他文章的引用始终保留；最后一个引用消失后才创建物理清理任务。

### 8.4 取消临时编辑

```text
DELETE /api/admin/post-assets/drafts/:draftToken/
```

### 8.5 删除预览

```text
GET /api/admin/posts/:postId/delete-preview/
```

返回按不同资产统计的独占与共享图片数量，不按 `usage` 行重复计数。现有文章 DELETE 接口在删除后额外返回 `cleanupPending`。

## 9. 前端模块边界

- `posts.astro`：表单结构、图片区域和初始文章数据；
- `admin-post-editor.ts`：新建、编辑、自动 Slug、光标插入与表单状态；
- `admin-post-media.ts`：上传队列、进度、图片清单、封面选择和移除；
- `admin-post-import.ts`：Markdown 解析到表单以及相对图片提示；
- 通用记录 CRUD 脚本继续管理其他后台页面，文章专用逻辑不继续堆入通用脚本。

模块之间通过表单字段、DOM 自定义事件和明确的 JSON 数据结构通信，避免让单个脚本同时承担上传、正文编辑、CRUD 和导入。

## 10. 备份与恢复

备份格式升级为 `schemaVersion: 2`，增加资产清单和文章引用元数据。JSON 仅保存 KV key、文件元数据和引用关系，不包含图片二进制。跨备份的稳定身份使用 `kv_key`，不依赖可能变化的 D1 资产 ID。

版本 2 导入在同一 D1 事务中按 `kv_key` 合并资产、替换文章引用、取消仍被导入内容使用的待删除任务，再把最终无引用的旧资产加入 `backup_restore` 清理队列。这样同一个 KV key 不会同时被恢复引用和旧清理任务删除。

旧 `schemaVersion: 1` 仍可导入。系统只处理 `/media/uploads/` 前缀，不登记 `public/media` 静态图片；对文章引用的旧上传路径，优先读取现有 KV metadata，文件大小可以暂时为 `NULL`。KV 对象缺失时记录恢复警告，不创建受管理资产，也不阻止其他内容导入。

## 11. 错误处理

- 不支持的格式返回 415；
- 空图片返回 422；
- 超过 5 MiB 返回 413；
- 不存在或不属于当前文章的图片返回 404；
- 待删除图片禁止建立新引用，返回 409；
- 保存失败时保留临时图片，允许用户重试；
- 删除文章成功但 KV 清理待重试时返回成功结果和待清理数量；
- UI 保留用户未保存的表单内容，并在具体图片旁显示上传错误。

## 12. 测试策略

### 12.1 单元测试

- Markdown 与 HTML 图片 URL 提取；
- 自动 Slug 与手动覆盖；
- Markdown 导入只填充表单；
- 内部图片 URL 与外部 URL 的识别；
- 图片类型、大小和文件名校验。

### 12.2 Workers 集成测试

- 上传状态从 `uploading` 到 `ready`；
- 临时图片绑定新文章；
- 封面、正文和图片库引用同步；
- 两篇文章共享同一图片；
- 删除其中一篇后 KV 对象继续存在；
- 删除最后一个引用后创建清理任务；
- KV 删除成功后资产和任务消失；
- KV 删除失败时文章已删除、任务保留且可幂等重试；
- 过期临时图片清理；
- 备份版本 1 与版本 2 导入。

### 12.3 浏览器测试

- 新建文章并上传封面；
- 上传正文图片并插入光标位置；
- 编辑文章、替换封面和移除图片；
- Markdown 导入预览；
- 删除确认显示独占与共享数量；
- 删除文章后验证独占图片已进入清理队列，并对带 cache-busting 参数的图片地址进行有限次数轮询；共享图片始终可访问；
- 320、390、768、1440 和 1920 宽度下编辑器可操作。

## 13. 发布与迁移

1. 新增 D1 migration；
2. 先在本地 Workers 测试环境应用迁移；
3. 更新并验证媒体、文章和备份接口；
4. 运行完整 check、unit、Workers 和 Playwright 测试；
5. 应用远程 D1 migration；
6. 执行一次文章图片回填：仅扫描文章中的 `/media/uploads/` 路径，从 KV metadata 建立资产与引用；页面设置和静态 `public/media` 图片不纳入；
7. 部署 Worker；
8. 验证新建、编辑、共享和删除流程；
9. 保留现有 `/media/uploads/...` URL，不迁移或重命名已上传对象。

## 14. 完成标准

- 博主无需手填封面路径即可上传和预览封面；
- 正文图片可上传并自动插入 Markdown；
- 每篇文章可查看和管理自己的图片；
- 同一图片可被多篇文章使用；
- 删除文章只清理独占图片；
- 清理失败可重试且不破坏文章数据库状态；
- Markdown 导入先预览后保存；
- 备份格式记录图片资产与引用；
- 所有自动测试和 Cloudflare 部署预检通过。
