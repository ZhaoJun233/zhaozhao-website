# “此刻”音乐、天气与时间页面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增可由后台长期维护的 `/now/`“海边窗景”页面，展示访客本地时间、所在区域天气和网易云指定歌曲播放器。

**Architecture:** 使用 D1 保存歌曲与页面文案，Cloudflare KV 保存可选歌曲封面，Astro SSR 输出页面结构，浏览器仅负责本地时间、定位和播放器切换。天气由本站固定代理 Open-Meteo，并使用 Cloudflare Cache API 缓存；网易云只通过歌曲 ID 生成嵌入播放器和外部歌曲链接，不引入 App ID、Private Key 或登录态。

**Tech Stack:** Astro 7、TypeScript 6、Cloudflare Workers、D1、KV、Open-Meteo、网易云音乐嵌入播放器、Vitest Workers、Playwright。

## Global Constraints

- 保持 Cloudflare-only 部署，不增加常驻 Node 服务、`mpv` 或 Docker 依赖。
- 网易云凭证、账号 Cookie 和登录态不得写入数据库、前端代码或 Git。
- 页面初始状态不自动播放；真实播放控制由网易云嵌入播放器提供。
- 不保存访客坐标、城市或天气查询历史。
- 天气上游固定为 `https://api.open-meteo.com`，不得接受任意 URL。
- 天气缓存时间为 10 分钟。
- 后台仍为单管理员，复用现有会话、API 错误结构和 D1 repository 模式。
- 桌面端和 390px 手机端均不得出现横向滚动。
- 动画必须遵循 `prefers-reduced-motion`。
- 每个任务遵循测试先行，并在独立通过后提交。

---

## File Structure

- `migrations/0008_now_music_weather.sql`：新增歌曲表、页面设置和“此刻”导航迁移。
- `src/data/now.json`：新环境默认页面文案。
- `src/data/content.ts`：`nowPageSchema` 与静态内容校验。
- `src/lib/admin/schemas.ts`：歌曲输入和 `now_page` 设置校验。
- `src/lib/database/types.ts`：D1 歌曲行类型。
- `src/lib/database/music-repository.ts`：前台歌曲读取和后台歌曲 CRUD、排序、封面同步。
- `src/lib/database/admin-repository.ts`：后台导出、导入和概览集成。
- `src/lib/database/media-repository.ts`：歌曲封面引用参与媒体清理判断。
- `src/lib/weather.ts`：坐标、天气上游、缓存键和返回结构的纯逻辑。
- `src/pages/api/weather.ts`：Cloudflare 位置降级、缓存与 Open-Meteo 请求。
- `src/pages/admin/music.astro`：歌曲管理页面。
- `src/pages/api/admin/music/**`：歌曲 CRUD、排序和封面上传 API。
- `src/scripts/admin-music.ts`：后台歌曲编辑器、封面预览和上传。
- `src/pages/now.astro`：海边窗景页面入口。
- `src/components/now/NowClock.astro`：时间和区域摘要。
- `src/components/now/WeatherPanel.astro`：天气展示和降级状态。
- `src/components/now/MusicPlayer.astro`：歌曲列表、当前歌曲与网易云 iframe 容器。
- `src/scripts/now-page.ts`：时间更新、定位、天气请求和歌曲选择。
- `tests/unit/weather.test.ts`：天气纯逻辑测试。
- `tests/unit/admin-api.test.ts`：歌曲输入约束。
- `tests/workers/music-repository.test.ts`：歌曲 D1 和封面生命周期测试。
- `tests/e2e/admin.spec.ts`：管理员歌曲维护流程。
- `tests/e2e/now.spec.ts`：桌面、手机、天气和音乐页面流程。

---

### Task 1: Database and Editable Page Settings

**Files:**
- Create: `migrations/0008_now_music_weather.sql`
- Create: `src/data/now.json`
- Modify: `src/data/navigation.json`
- Modify: `src/data/content.ts`
- Modify: `src/lib/admin/schemas.ts`
- Modify: `src/lib/runtime-content.ts`
- Modify: `scripts/generate-d1-seed.mjs`
- Modify: `migrations/0002_seed.sql`
- Test: `tests/unit/content.test.ts`
- Test: `tests/workers/runtime-content.test.ts`

**Interfaces:**
- Produces: `nowPageSchema`, `NowPageContent`, setting key `now_page`.
- Produces D1 table `music_tracks` with optional `cover_asset_id`.
- Later tasks consume `loadRuntimeEditorial().nowPage` and `music_tracks`.

- [ ] **Step 1: Write failing schema and runtime tests**

Add assertions that validate the exact editable shape and that runtime editorial includes it:

```ts
expect(nowPageSchema.parse({
  seoDescription: "访客时间、天气与今日选曲。",
  hero: {
    eyebrow: "A window by the sea",
    title: "此刻",
    weatherNotes: {
      clear: "天空很轻，适合把喜欢的歌慢慢听完。",
      cloudy: "云层压低了一点，音乐仍会留住光。",
      rain: "让雨声和旋律一起落在窗边。",
      snow: "雪把世界放慢，也把歌声衬得更近。",
      storm: "雷声经过时，先在这里安静听一首歌。",
      fallback: "天气暂时藏进云里了。",
    },
  },
  music: {
    eyebrow: "233昭的今日选曲",
    title: "让海风替我播放",
    emptyTitle: "唱片架还是空的",
    emptyDescription: "博主正在挑选第一首歌。",
    openLabel: "在网易云音乐中打开",
  },
})).toMatchObject({ hero: { title: "此刻" } });
```

In the Workers runtime test:

```ts
const editorial = await loadRuntimeEditorial();
expect(editorial.nowPage.music.openLabel).toBe("在网易云音乐中打开");
expect(editorial.navigation.items).toContainEqual({ label: "此刻", href: "/now/" });
```

- [ ] **Step 2: Run tests and verify the new contract is missing**

Run:

```powershell
npm run test:unit -- tests/unit/content.test.ts
npm run test:workers -- tests/workers/runtime-content.test.ts
```

Expected: FAIL because `nowPageSchema` and `now_page` do not exist.

- [ ] **Step 3: Add migration and schemas**

Create the migration with this structure:

```sql
CREATE TABLE music_tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  netease_song_id TEXT NOT NULL UNIQUE
    CHECK (
      netease_song_id <> ''
      AND netease_song_id NOT GLOB '*[^0-9]*'
      AND length(netease_song_id) BETWEEN 1 AND 20
    ),
  cover_asset_id TEXT REFERENCES media_assets(id) ON DELETE RESTRICT,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_music_tracks_enabled_order
  ON music_tracks(enabled, sort_order, title);

INSERT INTO site_settings (key, value_json, updated_at) VALUES (
  'now_page',
  '{"seoDescription":"访客时间、天气与今日选曲。","hero":{"eyebrow":"A window by the sea","title":"此刻","weatherNotes":{"clear":"天空很轻，适合把喜欢的歌慢慢听完。","cloudy":"云层压低了一点，音乐仍会留住光。","rain":"让雨声和旋律一起落在窗边。","snow":"雪把世界放慢，也把歌声衬得更近。","storm":"雷声经过时，先在这里安静听一首歌。","fallback":"天气暂时藏进云里了。"}},"music":{"eyebrow":"233昭的今日选曲","title":"让海风替我播放","emptyTitle":"唱片架还是空的","emptyDescription":"博主正在挑选第一首歌。","openLabel":"在网易云音乐中打开"}}',
  CURRENT_TIMESTAMP
);

UPDATE site_settings
SET value_json = json_insert(
  value_json,
  '$.items[#]',
  json_object('label', '此刻', 'href', '/now/')
), updated_at = CURRENT_TIMESTAMP
WHERE key = 'navigation'
  AND NOT EXISTS (
    SELECT 1 FROM json_each(value_json, '$.items') item
    WHERE json_extract(item.value, '$.href') = '/now/'
  );
```

Add `nowPageSchema` to `src/data/content.ts`, add `now_page` to `settingSchemas`, and load it in `loadRuntimeEditorial()` beside the other `site_settings` values.

- [ ] **Step 4: Add default JSON and seed support**

Create `src/data/now.json` matching the schema, insert `"此刻"` before `"关于"` in `src/data/navigation.json`, and add:

```js
["now_page", "now.json"],
```

to `settingFiles` in `scripts/generate-d1-seed.mjs`. Regenerate the seed:

```powershell
npm run db:seed:generate
```

- [ ] **Step 5: Run targeted tests**

Run:

```powershell
npm run test:unit -- tests/unit/content.test.ts
npm run test:workers -- tests/workers/runtime-content.test.ts
```

Expected: both files PASS.

- [ ] **Step 6: Commit**

```powershell
git add migrations/0008_now_music_weather.sql migrations/0002_seed.sql src/data/now.json src/data/navigation.json src/data/content.ts src/lib/admin/schemas.ts src/lib/runtime-content.ts scripts/generate-d1-seed.mjs tests/unit/content.test.ts tests/workers/runtime-content.test.ts
git commit -m "feat: add now page data foundation"
```

---

### Task 2: Music Repository, Validation, and Admin APIs

**Files:**
- Create: `src/lib/database/music-repository.ts`
- Create: `src/pages/api/admin/music/index.ts`
- Create: `src/pages/api/admin/music/[id].ts`
- Create: `src/pages/api/admin/music/order.ts`
- Modify: `src/lib/admin/schemas.ts`
- Modify: `src/lib/database/types.ts`
- Modify: `src/lib/database/admin-repository.ts`
- Test: `tests/unit/admin-api.test.ts`
- Test: `tests/workers/music-repository.test.ts`

**Interfaces:**
- Produces `MusicTrackInput`:

```ts
type MusicTrackInput = {
  title: string;
  artist: string;
  neteaseSongId: string;
  note?: string;
  enabled: boolean;
  draftToken?: string;
  coverAssetId?: string;
};
```

- Produces `AdminMusicTrack` with `coverAssetId?: string`, `coverUrl?: string`, `embedUrl: string`, `neteaseUrl: string` and `sortOrder: number`.
- Produces `listMusicTracks`, `listEnabledMusicTracks`, `getMusicTrack`, `createMusicTrack`, `updateMusicTrack`, `deleteMusicTrack`, `orderMusicTracks`.

- [ ] **Step 1: Write failing input tests**

Add to `tests/unit/admin-api.test.ts`:

```ts
expect(musicTrackInputSchema.parse({
  title: "夜晚的歌",
  artist: "歌手",
  neteaseSongId: "123456789",
  enabled: true,
})).toMatchObject({ neteaseSongId: "123456789" });

expect(() => musicTrackInputSchema.parse({
  title: "错误歌曲",
  artist: "歌手",
  neteaseSongId: "https://music.163.com/song?id=1",
  enabled: true,
})).toThrow("网易云歌曲 ID 只能填写数字");
```

- [ ] **Step 2: Write failing repository tests**

Cover create, update, duplicate song ID, enabled filtering, ordering and deletion:

```ts
const first = await createMusicTrack(env.DB, {
  title: "第一首歌",
  artist: "歌手 A",
  neteaseSongId: "101",
  enabled: true,
});
const second = await createMusicTrack(env.DB, {
  title: "第二首歌",
  artist: "歌手 B",
  neteaseSongId: "202",
  enabled: false,
});
expect(await listEnabledMusicTracks(env.DB)).toEqual([
  expect.objectContaining({ id: first.id, neteaseSongId: "101" }),
]);
await expect(createMusicTrack(env.DB, {
  title: "重复",
  artist: "歌手 C",
  neteaseSongId: "101",
  enabled: true,
})).rejects.toThrow("该网易云歌曲已经存在");
await orderMusicTracks(env.DB, [second.id, first.id]);
expect((await listMusicTracks(env.DB)).map(({ id }) => id)).toEqual([second.id, first.id]);
```

- [ ] **Step 3: Run tests and verify failure**

Run:

```powershell
npm run test:unit -- tests/unit/admin-api.test.ts
npm run test:workers -- tests/workers/music-repository.test.ts
```

Expected: FAIL because music schemas and repository exports are absent.

- [ ] **Step 4: Implement row mapping and CRUD**

Define `MusicTrackRow` in `src/lib/database/types.ts`. In `music-repository.ts`, map snake_case rows to the public type and generate stable links:

```ts
export function neteaseSongUrl(songId: string): string {
  return `https://music.163.com/#/song?id=${encodeURIComponent(songId)}`;
}

export function neteaseEmbedUrl(songId: string): string {
  return `https://music.163.com/outchain/player?type=2&id=${encodeURIComponent(songId)}&auto=0&height=66`;
}
```

Use `randomUUID()`, `nextOrder`, D1 primary sessions and `AdminConflictError`/`AdminNotFoundError` consistently with friends and categories. Convert D1 unique constraint errors to `AdminConflictError("该网易云歌曲已经存在。")`.

- [ ] **Step 5: Add API routes**

Follow the existing admin handler shape:

```ts
export const GET: APIRoute = ({ request }) =>
  handleAdminRequest(request, listMusicTracks);

export const POST: APIRoute = ({ request }) => handleAdminRequest(
  request,
  async (database) => createMusicTrack(database, await readAdminJson(request) as never),
);
```

The `[id]` route exposes GET, PUT and DELETE. The order route validates `z.array(z.uuid()).max(100)`.

- [ ] **Step 6: Include music in admin overview**

Add a music count query to `getAdminOverview()` and return `musicTracks` without changing existing keys.

- [ ] **Step 7: Run targeted tests**

```powershell
npm run test:unit -- tests/unit/admin-api.test.ts
npm run test:workers -- tests/workers/music-repository.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/lib/admin/schemas.ts src/lib/database/types.ts src/lib/database/music-repository.ts src/lib/database/admin-repository.ts src/pages/api/admin/music tests/unit/admin-api.test.ts tests/workers/music-repository.test.ts
git commit -m "feat: add music track management api"
```

---

### Task 3: Managed Music Cover Lifecycle

**Files:**
- Create: `src/pages/api/admin/music/assets.ts`
- Modify: `src/lib/database/music-repository.ts`
- Modify: `src/lib/database/media-repository.ts`
- Modify: `src/lib/cloudflare/post-media.ts`
- Modify: `src/lib/database/types.ts`
- Test: `tests/workers/music-repository.test.ts`
- Test: `tests/workers/media-repository.test.ts`

**Interfaces:**
- Reuses `uploadPostImage(database, store, file, { draftToken })` as a managed generic image upload until it is renamed in a later refactor.
- `createMusicTrack` and `updateMusicTrack` accept `draftToken` and `coverAssetId` and clear the matching draft token atomically.
- `deleteMusicTrack` queues an unshared cover in `media_cleanup_jobs` with reason `manual_remove`.

- [ ] **Step 1: Write failing cover ownership tests**

Test a draft cover is linked on save and cannot be stolen by another draft token:

```ts
const asset = await beginMediaUpload(env.DB, {
  key: "uploads/2026/07/music-cover.png",
  originalName: "music-cover.png",
  contentType: "image/png",
  sizeBytes: 4,
  draftToken,
});
await markMediaReady(env.DB, asset.id);

const track = await createMusicTrack(env.DB, {
  title: "有封面的歌",
  artist: "歌手",
  neteaseSongId: "303",
  enabled: true,
  draftToken,
  coverAssetId: asset.id,
});
expect(track.coverUrl).toBe("/media/uploads/2026/07/music-cover.png/");

await expect(createMusicTrack(env.DB, {
  title: "错误归属",
  artist: "歌手",
  neteaseSongId: "304",
  enabled: true,
  draftToken: "22222222-2222-4222-8222-222222222222",
  coverAssetId: asset.id,
})).rejects.toThrow();
```

Also test replacing/deleting the final reference creates one cleanup job, while a cover referenced by another track or post remains ready.

- [ ] **Step 2: Run Workers tests and verify failure**

```powershell
npm run test:workers -- tests/workers/music-repository.test.ts tests/workers/media-repository.test.ts
```

Expected: FAIL because music covers are not synchronized or considered by cleanup.

- [ ] **Step 3: Add cover resolution and atomic synchronization**

In `music-repository.ts`, resolve a cover only when:

```sql
SELECT * FROM media_assets
WHERE id = ? AND state = 'ready'
  AND (draft_token IS NULL OR draft_token = ?)
```

For create/update, batch the track write with:

```sql
UPDATE media_assets SET draft_token = NULL
WHERE id = ? AND draft_token = ? AND state = 'ready';
```

When a previous cover becomes unreferenced by both `post_asset_links` and `music_tracks`, set it to `pending_delete` and insert a `manual_remove` cleanup job.

- [ ] **Step 4: Protect music covers in generic cleanup queries**

Update every cleanup eligibility clause that currently only checks `post_asset_links` to also require:

```sql
AND NOT EXISTS (
  SELECT 1 FROM music_tracks track WHERE track.cover_asset_id = media_assets.id
)
```

Apply the same protection to cleanup claiming and completion so a queued asset cannot be deleted after a music track starts referencing it.

- [ ] **Step 5: Add the authenticated cover upload route**

`POST /api/admin/music/assets/` accepts multipart fields `file` and `draftToken`, validates a UUID, calls `uploadPostImage(database, getMediaStore(), file, { draftToken })`, then runs best-effort cleanup. Return `{ asset }` using the existing admin response envelope.

- [ ] **Step 6: Run targeted Workers tests**

```powershell
npm run test:workers -- tests/workers/music-repository.test.ts tests/workers/media-repository.test.ts
```

Expected: PASS with no residual cleanup jobs after explicit test cleanup.

- [ ] **Step 7: Commit**

```powershell
git add src/pages/api/admin/music/assets.ts src/lib/database/music-repository.ts src/lib/database/media-repository.ts src/lib/cloudflare/post-media.ts src/lib/database/types.ts tests/workers/music-repository.test.ts tests/workers/media-repository.test.ts
git commit -m "feat: manage music cover lifecycle"
```

---

### Task 4: Administrator Music Interface

**Files:**
- Create: `src/pages/admin/music.astro`
- Create: `src/scripts/admin-music.ts`
- Modify: `src/components/admin/AdminShell.astro`
- Modify: `src/layouts/AdminLayout.astro`
- Modify: `src/styles/admin.css`
- Test: `tests/e2e/admin.spec.ts`

**Interfaces:**
- Admin navigation key adds `music` and route `/admin/music/`.
- The page reads `listMusicTracks(getDatabase())` and embeds record JSON in `data-music-records`.
- The client script uses `/api/admin/music/`, `/api/admin/music/order/`, and `/api/admin/music/assets/`.

- [ ] **Step 1: Write the failing administrator E2E flow**

Add a desktop-only test that:

```ts
await loginAsAdministrator(page);
await page.getByRole("link", { name: "音乐", exact: true }).click();
await page.getByRole("button", { name: "新增歌曲" }).click();
await page.getByLabel("歌曲名称").fill(trackTitle);
await page.getByLabel("歌手").fill("测试歌手");
await page.getByLabel("网易云歌曲 ID").fill("1234567890");
await page.getByLabel("推荐语").fill("适合海风轻轻吹过的时候。");
await page.locator("[data-music-cover-input]").setInputFiles("tests/fixtures/post-cover.png");
await expect(page.locator("[data-music-cover-preview] img")).toBeVisible();
await page.getByRole("button", { name: "保存歌曲" }).click();
await expect(page.getByText(trackTitle, { exact: true })).toBeVisible();
```

Then edit, reorder, disable, delete, and assert the uploaded cover eventually returns 404.

- [ ] **Step 2: Run E2E and verify the admin page is absent**

```powershell
npx playwright test tests/e2e/admin.spec.ts -g "administrator manages music" --project=desktop-1440
```

Expected: FAIL at the missing “音乐” navigation link.

- [ ] **Step 3: Add navigation and page structure**

Add `Music2` to `AdminShell.astro`, extend `active` with `"music"`, and add:

```ts
{ key: "music", label: "音乐", href: "/admin/music/", icon: Music2 },
```

The page contains a sortable table and editor fields named `title`, `artist`, `neteaseSongId`, `note`, `enabled`, `draftToken`, and `coverAssetId`. Generate a UUID draft token in Astro frontmatter for each fresh editor load.

- [ ] **Step 4: Implement `admin-music.ts`**

The script must:

- populate fields from the selected track;
- upload the selected cover immediately and store returned `asset.id`;
- show a local preview before upload finishes;
- serialize `draftToken` and `coverAssetId`;
- use native `label`/file input behavior on mobile;
- call CRUD and order endpoints;
- cancel unused drafts with `DELETE /api/admin/post-assets/drafts/{draftToken}/`, which already queues generic managed draft images for cleanup;
- show concrete Chinese API errors beside the form.

- [ ] **Step 5: Add responsive admin styles**

Keep inputs at least 44px high on narrow screens. At widths below 760px, stack the table and editor, keep cover preview within `max-inline-size: 100%`, and verify no horizontal overflow.

- [ ] **Step 6: Run desktop and mobile E2E tests**

```powershell
npx playwright test tests/e2e/admin.spec.ts -g "administrator manages music" --project=desktop-1440
npx playwright test tests/e2e/admin.spec.ts -g "music editor stays operable" --project=mobile-390
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/pages/admin/music.astro src/scripts/admin-music.ts src/components/admin/AdminShell.astro src/layouts/AdminLayout.astro src/styles/admin.css tests/e2e/admin.spec.ts
git commit -m "feat: add music management interface"
```

---

### Task 5: Weather Service and Privacy-Preserving API

**Files:**
- Create: `src/lib/weather.ts`
- Create: `src/pages/api/weather.ts`
- Test: `tests/unit/weather.test.ts`
- Test: `tests/workers/weather.test.ts`

**Interfaces:**
- Produces:

```ts
export interface WeatherSnapshot {
  area: string;
  code: number;
  condition: string;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windDirection: number;
  windSpeed: number;
  observedAt: string;
}

export function normalizeCoordinates(lat: unknown, lon: unknown): { latitude: number; longitude: number };
export function weatherCacheKey(latitude: number, longitude: number): string;
export function weatherCondition(code: number): string;
export async function fetchWeatherSnapshot(input: WeatherFetchInput): Promise<WeatherSnapshot>;
```

- `/api/weather?lat=...&lon=...` returns `{ data: WeatherSnapshot }` with `cache-control: public, max-age=600`.

- [ ] **Step 1: Write failing pure logic tests**

```ts
expect(normalizeCoordinates("30.2741", "120.1551")).toEqual({
  latitude: 30.2741,
  longitude: 120.1551,
});
expect(() => normalizeCoordinates("91", "120")).toThrow("纬度必须在 -90 到 90 之间");
expect(weatherCacheKey(30.27419, 120.15519)).toBe("weather:30.27:120.16");
expect(weatherCondition(0)).toBe("晴");
expect(weatherCondition(95)).toBe("雷雨");
```

- [ ] **Step 2: Write failing Worker route tests**

Use a route factory with injected `fetcher` and cache adapter. Verify browser coordinates take priority, Cloudflare coordinates are used when query parameters are absent, only the fixed Open-Meteo host is fetched, and an upstream error returns status 503 with `天气暂时藏进云里了。`.

- [ ] **Step 3: Run tests and verify failure**

```powershell
npm run test:unit -- tests/unit/weather.test.ts
npm run test:workers -- tests/workers/weather.test.ts
```

- [ ] **Step 4: Implement fixed upstream request**

Build only this endpoint shape:

```ts
const url = new URL("https://api.open-meteo.com/v1/forecast");
url.searchParams.set("latitude", String(latitude));
url.searchParams.set("longitude", String(longitude));
url.searchParams.set(
  "current",
  "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m",
);
url.searchParams.set("timezone", "auto");
```

Use an abort timeout of 5 seconds. Parse the response with Zod before mapping it to `WeatherSnapshot`.

- [ ] **Step 5: Implement Cloudflare fallback and cache**

Read `request.cf?.latitude`, `longitude`, and `city` through a narrow local type. Round coordinates to two decimals for the cache key. Use `caches.default.match()` and await `caches.default.put()` before returning a fresh response; never store raw precise coordinates or log them.

- [ ] **Step 6: Run targeted tests**

```powershell
npm run test:unit -- tests/unit/weather.test.ts
npm run test:workers -- tests/workers/weather.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/weather.ts src/pages/api/weather.ts tests/unit/weather.test.ts tests/workers/weather.test.ts
git commit -m "feat: add visitor weather service"
```

---

### Task 6: “Sea Window” Frontend Page

**Files:**
- Create: `src/pages/now.astro`
- Create: `src/components/now/NowClock.astro`
- Create: `src/components/now/WeatherPanel.astro`
- Create: `src/components/now/MusicPlayer.astro`
- Create: `src/scripts/now-page.ts`
- Modify: `src/layouts/BaseLayout.astro`
- Test: `tests/e2e/now.spec.ts`
- Test: `tests/e2e/accessibility.spec.ts`

**Interfaces:**
- `now.astro` consumes `loadRuntimeEditorial().nowPage` and `listEnabledMusicTracks(getDatabase())`.
- `MusicPlayer.astro` receives `tracks: AdminMusicTrack[]` and renders one inactive iframe shell.
- `now-page.ts` reads `data-weather-endpoint`, `data-track`, and `data-netease-embed` attributes.

- [ ] **Step 1: Write failing desktop and mobile page tests**

Desktop assertions:

```ts
await page.goto("/now/");
await expect(page.getByRole("heading", { level: 1, name: "此刻" })).toBeVisible();
await expect(page.getByLabel("当前时间")).toBeVisible();
await expect(page.getByRole("region", { name: "访客天气" })).toBeVisible();
await expect(page.getByRole("region", { name: "233昭的今日选曲" })).toBeVisible();
await expect(page.locator("iframe[src*='music.163.com/outchain/player']")).toHaveCount(0);
```

After clicking an enabled track, assert exactly one iframe exists and its URL contains the selected numeric ID. Mobile assertions verify the order “time before weather before music”, 44px controls, and no horizontal overflow.

- [ ] **Step 2: Run E2E and verify `/now/` is missing**

```powershell
npx playwright test tests/e2e/now.spec.ts --project=desktop-1440
npx playwright test tests/e2e/now.spec.ts --project=mobile-390
```

- [ ] **Step 3: Build the SSR structure**

`now.astro` uses `BaseLayout` with `page="now"`, outputs the clock/weather hero, and renders either `MusicPlayer` or the editable empty state. The iframe is not present until a visitor selects a track.

Every track button includes:

```html
data-track-id={track.id}
data-track-title={track.title}
data-track-artist={track.artist}
data-track-cover={track.coverUrl ?? ""}
data-netease-embed={track.embedUrl}
data-netease-url={track.neteaseUrl}
```

- [ ] **Step 4: Implement local time and day-part theming**

Use `Intl.DateTimeFormat` for time, date and weekday. Set `data-day-part` to `dawn`, `day`, `dusk`, or `night` based on the visitor hour. Update once per minute and when `visibilitychange` returns to visible.

- [ ] **Step 5: Implement weather location flow**

Call `/api/weather` immediately without precise coordinates to show Cloudflare-area weather. If `navigator.geolocation` is available and permission is not known to be denied, request the current position once, then refresh with `lat` and `lon`. Store only a session flag indicating that the permission prompt was attempted; do not store coordinates.

Map weather codes to the configured `clear`, `cloudy`, `rain`, `snow`, or `storm` note. On failure, retain the server-rendered weather shell and set its message to `hero.weatherNotes.fallback`.

- [ ] **Step 6: Implement music selection**

On click, update current metadata, selected row and external link, then replace the iframe container with exactly one iframe:

```ts
const iframe = document.createElement("iframe");
iframe.src = button.dataset.neteaseEmbed!;
iframe.title = `网易云音乐播放器：${button.dataset.trackTitle}`;
iframe.loading = "lazy";
iframe.allow = "autoplay; encrypted-media";
```

Do not expose custom fake progress controls. The vinyl animation means “selected song”, not verified remote playback state.

- [ ] **Step 7: Implement responsive “sea window” styling**

Use existing color tokens plus page-local gradient variables. Desktop uses the approved two-column hero and horizontal player; below 760px use the approved single column. Add `@media (prefers-reduced-motion: reduce)` to stop vinyl rotation and decorative transitions.

- [ ] **Step 8: Add accessibility coverage**

Add `['此刻', '/now/']` to the representative Axe page list. Ensure regions have headings, track selection exposes `aria-pressed`, iframe has a title, weather updates use a polite live region, and color contrast passes WCAG A/AA.

- [ ] **Step 9: Run page tests**

```powershell
npx playwright test tests/e2e/now.spec.ts --project=desktop-1440
npx playwright test tests/e2e/now.spec.ts --project=mobile-390
npx playwright test tests/e2e/accessibility.spec.ts -g "此刻" --project=desktop-1440
```

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add src/pages/now.astro src/components/now src/scripts/now-page.ts src/layouts/BaseLayout.astro tests/e2e/now.spec.ts tests/e2e/accessibility.spec.ts
git commit -m "feat: add sea window now page"
```

---

### Task 7: Backup, Restore, and Long-Term Maintenance

**Files:**
- Modify: `src/lib/database/admin-repository.ts`
- Modify: `tests/workers/admin-repository.test.ts`
- Modify: `src/pages/admin/data.astro`

**Interfaces:**
- Produces `BlogBackupV3` with `schemaVersion: 3` and `musicTracks: AdminMusicTrack[]`.
- V1 and V2 imports remain supported.
- V3 media assets include covers referenced by either `post_asset_links` or `music_tracks.cover_asset_id`.

- [ ] **Step 1: Write failing backup round-trip tests**

Create a track with a registered cover, export it, delete all content, import the backup, and verify:

```ts
const backup = await exportBlogData(env.DB);
expect(backup.schemaVersion).toBe(3);
if (backup.schemaVersion !== 3) throw new Error("Expected schema version 3.");
expect(backup.musicTracks).toContainEqual(expect.objectContaining({
  neteaseSongId: "505",
  coverAssetId: cover.id,
}));
await importBlogData(env.DB, backup);
expect(await listMusicTracks(env.DB)).toContainEqual(expect.objectContaining({
  neteaseSongId: "505",
  coverUrl: "/media/uploads/2026/07/backup-music.png/",
}));
```

Also verify V1 and V2 fixtures import with an empty music list.

- [ ] **Step 2: Run the test and verify V3 is missing**

```powershell
npm run test:workers -- tests/workers/admin-repository.test.ts
```

- [ ] **Step 3: Define and validate V3**

Add:

```ts
export interface BlogBackupV3 extends Omit<BlogBackupV2, "schemaVersion"> {
  schemaVersion: 3;
  musicTracks: AdminMusicTrack[];
}
```

Update the backup page description to state that exports include page settings, categories, articles, projects, friends, messages, music tracks and managed images.

Validate music IDs, unique track IDs, unique网易云 IDs, cover asset references, sort order and enabled state. Accept only media keys already present in `mediaAssets`.

- [ ] **Step 4: Export music and cover assets**

Extend the media query so assets are included when referenced by either source:

```sql
WHERE asset.state = 'ready' AND (
  EXISTS (SELECT 1 FROM post_asset_links link WHERE link.asset_id = asset.id)
  OR EXISTS (SELECT 1 FROM music_tracks track WHERE track.cover_asset_id = asset.id)
)
```

Return V3 with `musicTracks: await listMusicTracks(database)`.

- [ ] **Step 5: Restore music after media assets**

Delete `music_tracks` before replacing settings. For V3, insert media assets before track statements and bind `cover_asset_id` only when that asset exists in the validated media list. V1/V2 restore no music rows.

- [ ] **Step 6: Run backup tests**

```powershell
npm run test:workers -- tests/workers/admin-repository.test.ts
```

Expected: PASS including V1/V2 compatibility.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/database/admin-repository.ts tests/workers/admin-repository.test.ts src/pages/admin/data.astro
git commit -m "feat: include music in blog backups"
```

---

### Task 8: Full Regression, Cloudflare Deployment, and Production Verification

**Files:**
- Modify only files required by failures discovered in this task.

**Interfaces:**
- Consumes every interface from Tasks 1–7.
- Produces a deployed Worker and applied remote D1 migration.

- [ ] **Step 1: Regenerate Cloudflare types and seed**

```powershell
npm run cf:typegen
npm run db:seed:generate
```

Expected: generated files contain no secrets and `0002_seed.sql` contains `now_page` and the `/now/` navigation item.

- [ ] **Step 2: Run static checks and all automated tests**

```powershell
npm run check
npm test
npm run build
npx playwright test tests/e2e/now.spec.ts tests/e2e/admin.spec.ts --project=desktop-1440
npx playwright test tests/e2e/now.spec.ts tests/e2e/admin.spec.ts --project=mobile-390
```

Expected: zero errors and zero failed tests. Existing TypeScript deprecation hints may remain unchanged.

- [ ] **Step 3: Inspect media cleanup state locally**

Run local D1 queries and verify no test leftovers:

```powershell
npx wrangler d1 execute zhaozhao-blog --local --command "SELECT COUNT(*) AS count FROM music_tracks; SELECT COUNT(*) AS count FROM media_cleanup_jobs;"
```

Expected: no E2E test tracks and zero pending cleanup jobs after cleanup polling.

- [ ] **Step 4: Apply remote migration**

```powershell
npm run db:migrate:remote
```

Expected: `0008_now_music_weather.sql` is applied successfully.

- [ ] **Step 5: Deploy**

```powershell
npm run deploy
```

Expected: Wrangler reports a new Worker version for `zhaozhao-website`.

- [ ] **Step 6: Verify production behavior**

Check:

```powershell
Invoke-WebRequest -UseBasicParsing https://zhao233.de5.net/now/
Invoke-WebRequest -UseBasicParsing https://zhao233.de5.net/api/weather
Invoke-WebRequest -UseBasicParsing https://zhao233.de5.net/admin/music/
```

Then use Playwright against production at 390px to verify `/now/` has no horizontal overflow, shows time/weather, and creates one网易云 iframe only after selecting a configured song.

- [ ] **Step 7: Confirm remote D1 cleanup state**

```powershell
npx wrangler d1 execute zhaozhao-blog --remote --command "SELECT COUNT(*) AS cleanup_jobs FROM media_cleanup_jobs;"
```

Expected: `cleanup_jobs = 0`.

- [ ] **Step 8: Commit any final verification fixes**

```powershell
git add -A
git commit -m "fix: finalize now page integration"
```

Skip this commit when the working tree is already clean.
