# Homepage Weather and Music Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move visitor weather and managed NetEase music onto the existing homepage without changing its current content, and consolidate their administration under “页面内容”.

**Architecture:** Add one self-contained homepage section between the existing site-status strip and featured posts. Reuse the weather and music presentation components, extract a client initializer that has no clock dependency, preserve the existing APIs and D1 music model, and retain old front/admin URLs as permanent redirects. Move the music manager markup into a reusable admin component embedded in `/admin/content/` while keeping `now_page` as the persisted settings key.

**Tech Stack:** Astro 7, TypeScript 6, Cloudflare Workers, D1/SQLite JSON1, Vitest, Playwright, lucide-astro.

## Global Constraints

- Do not change the existing Home Hero, site-status, featured posts, topic band, featured projects, or introduction components.
- Do not render local time, date, greeting, or day-part theme logic on the homepage.
- The homepage section order is Hero → site status → weather and music → featured posts → topics → projects → introduction.
- Initial page load must not create or autoplay a NetEase iframe; one iframe is created only after a visitor selects a track.
- Weather continues to use `/api/weather/`, Open-Meteo, the existing five-second upstream timeout, Cloudflare location fallback, and ten-minute cache behavior.
- Keep `now_page`, `music_tracks`, music APIs, media reference protection, cleanup jobs, and BlogBackupV3 compatible with existing data.
- `/now/` permanently redirects to `/#weather-music`; `/admin/music/` permanently redirects to `/admin/content/#home-weather-music`.
- Remove the “此刻” public navigation item and the standalone “音乐” admin navigation item.
- Desktop uses a weather/music two-column composition; 390 px mobile uses weather above music with no horizontal overflow and controls at least 44 px high.
- Use test-first red-green-refactor cycles and commit after every task.

---

### Task 1: Remove the standalone public navigation contract

**Files:**
- Modify: `tests/unit/site-config.test.ts`
- Modify: `tests/workers/runtime-content.test.ts`
- Modify: `src/data/navigation.json`
- Create: `migrations/0009_remove_now_navigation.sql`
- Regenerate: `migrations/0002_seed.sql`

**Interfaces:**
- Consumes: `siteConfig.navigation: NavigationItem[]` and `loadRuntimeEditorial().navigation.items`.
- Produces: navigation arrays with no `{ label: "此刻", href: "/now/" }` entry, plus an idempotent production D1 migration.

- [ ] **Step 1: Change the navigation tests first**

Update `tests/unit/site-config.test.ts` to expect the exact route sequence:

```ts
expect(siteConfig.navigation.map((item) => item.href)).toEqual([
  "/",
  "/posts/",
  "/categories/",
  "/archive/",
  "/projects/",
  "/friends/",
  "/about/",
  "/guestbook/",
]);
```

Replace the runtime assertion in `tests/workers/runtime-content.test.ts` with:

```ts
expect(editorial.navigation.items).not.toContainEqual({
  label: "此刻",
  href: "/now/",
});
expect(editorial.navigation.items.map(({ href }) => href)).toEqual([
  "/",
  "/posts/",
  "/categories/",
  "/archive/",
  "/projects/",
  "/friends/",
  "/about/",
  "/guestbook/",
]);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npx vitest run tests/unit/site-config.test.ts
npx vitest run --config vitest.workers.config.ts tests/workers/runtime-content.test.ts
```

Expected: both commands fail because `/now/` is still present.

- [ ] **Step 3: Remove the default navigation item and add the D1 migration**

Delete this object from `src/data/navigation.json`:

```json
{ "label": "此刻", "href": "/now/" }
```

Create `migrations/0009_remove_now_navigation.sql` with:

```sql
UPDATE site_settings
SET value_json = json_set(
      value_json,
      '$.items',
      json(COALESCE(
        (
          SELECT json_group_array(json(item.value))
          FROM json_each(site_settings.value_json, '$.items') AS item
          WHERE json_extract(item.value, '$.href') <> '/now/'
        ),
        '[]'
      ))
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE key = 'navigation'
  AND EXISTS (
    SELECT 1
    FROM json_each(site_settings.value_json, '$.items') AS item
    WHERE json_extract(item.value, '$.href') = '/now/'
  );
```

Regenerate the seed from source JSON:

```powershell
npm run db:seed:generate
```

Inspect `migrations/0002_seed.sql` and confirm its `navigation` JSON contains no `/now/` entry.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```powershell
npx vitest run tests/unit/site-config.test.ts
npx vitest run --config vitest.workers.config.ts tests/workers/runtime-content.test.ts
```

Expected: both commands pass.

- [ ] **Step 5: Commit the navigation change**

```powershell
git add tests/unit/site-config.test.ts tests/workers/runtime-content.test.ts src/data/navigation.json migrations/0009_remove_now_navigation.sql migrations/0002_seed.sql
git commit -m "refactor: remove standalone now navigation"
```

---

### Task 2: Add the weather and music section to the homepage

**Files:**
- Create: `src/components/home/HomeWeatherMusic.astro`
- Create: `src/scripts/home-weather-music.ts`
- Modify: `src/components/now/WeatherPanel.astro`
- Modify: `src/components/now/MusicPlayer.astro`
- Modify: `src/pages/index.astro`
- Replace: `src/pages/now.astro`
- Delete: `src/components/now/NowClock.astro`
- Delete: `src/scripts/now-page.ts`
- Rename: `tests/e2e/now.spec.ts` → `tests/e2e/home-weather-music.spec.ts`
- Modify: `tests/e2e/home.spec.ts`

**Interfaces:**
- Consumes: `listEnabledMusicTracks(database): Promise<AdminMusicTrack[]>`, `editorial.nowPage.hero.weatherNotes`, `editorial.nowPage.music`, `/api/weather/`, and the existing WeatherPanel/MusicPlayer DOM data attributes.
- Produces: `<section id="weather-music" data-home-weather-music data-weather-endpoint="/api/weather/">`, plus `home-weather-music.ts` that initializes only weather and music.

- [ ] **Step 1: Rewrite the browser tests for the desired homepage behavior**

Rename `tests/e2e/now.spec.ts` to `tests/e2e/home-weather-music.spec.ts`. Keep its login, music fixture creation, weather route stub, iframe assertions, and cleanup, but change the core navigation and assertions to:

```ts
await page.goto("/");
await expect(page.locator("#weather-music")).toBeVisible();
await expect(page.getByRole("region", { name: "访客天气" })).toBeVisible();
await expect(page.getByRole("region", { name: "233昭的今日选曲" })).toBeVisible();
await expect(page.locator("[data-now-time], [data-now-date], [data-now-greeting]")).toHaveCount(0);
await expect(page.getByText("杭州", { exact: true })).toBeVisible();
await expect.poll(() => weatherRequests.some((url) => (
  url.includes("lat=30.2741") && url.includes("lon=120.1551")
))).toBe(true);
await expect(page.locator("iframe[src*='music.163.com/outchain/player']")).toHaveCount(0);
```

For the mobile branch, remove the time box and assert:

```ts
const weatherBox = await page.locator("[data-home-section='weather']").boundingBox();
const musicBox = await page.locator("[data-home-section='music']").boundingBox();
expect(weatherBox).not.toBeNull();
expect(musicBox).not.toBeNull();
expect(weatherBox!.y).toBeLessThan(musicBox!.y);
expect((await track.boundingBox())!.height).toBeGreaterThanOrEqual(44);
```

Add a separate redirect test in the same file:

```ts
test("legacy now route redirects to the homepage section", async ({ page }) => {
  const response = await page.goto("/now/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/#weather-music$/);
  await expect(page.locator("#weather-music")).toBeVisible();
});
```

Add these assertions to `tests/e2e/home.spec.ts` without removing the existing homepage assertions:

```ts
await expect(page.locator("#weather-music")).toBeVisible();
await expect(page.getByTestId("featured-posts")).toBeVisible();
await expect(page.getByTestId("home-introduction")).toBeVisible();
```

- [ ] **Step 2: Run the focused browser tests and verify RED**

Run:

```powershell
npx playwright test tests/e2e/home-weather-music.spec.ts tests/e2e/home.spec.ts --project=desktop-1440 --project=mobile-390
```

Expected: the homepage section assertions fail because weather and music still live at `/now/`.

- [ ] **Step 3: Create the homepage composition component**

Create `src/components/home/HomeWeatherMusic.astro` with this public structure:

```astro
---
import type { AdminMusicTrack } from "../../lib/database/music-repository";
import MusicPlayer from "../now/MusicPlayer.astro";
import WeatherPanel from "../now/WeatherPanel.astro";

interface Props {
  tracks: AdminMusicTrack[];
  content: {
    hero: {
      eyebrow: string;
      title: string;
      weatherNotes: {
        clear: string;
        cloudy: string;
        rain: string;
        snow: string;
        storm: string;
        fallback: string;
      };
    };
    music: {
      eyebrow: string;
      title: string;
      emptyTitle: string;
      emptyDescription: string;
      openLabel: string;
    };
  };
}

const { tracks, content } = Astro.props;
---

<section
  id="weather-music"
  class="home-weather-music"
  data-home-weather-music
  data-weather-endpoint="/api/weather/"
  aria-label="天气与音乐"
>
  <div class="home-weather-music__glow" aria-hidden="true"></div>
  <div class="home-weather-music__inner">
    <header class="home-weather-music__heading">
      <p>{content.hero.eyebrow}</p>
      <h2>{content.hero.title}</h2>
    </header>
    <div class="home-weather-music__grid">
      <WeatherPanel notes={content.hero.weatherNotes} />
      <MusicPlayer tracks={tracks} content={content.music} />
    </div>
  </div>
  <p class="home-weather-music__privacy">位置仅用于本次天气查询，不会保存。</p>
  <script
    is:inline
    type="application/json"
    data-weather-notes
    set:html={JSON.stringify(content.hero.weatherNotes)}
  ></script>
</section>

<script>
  import "../../scripts/home-weather-music";
</script>
```

Add scoped CSS in the same component with these exact layout rules:

- Root variables: `--home-sky: #b8dce5`, `--home-sand: #f2dcc2`, `--home-sea: #4f93a4`, `--home-ink: #183b43`.
- Root background: a restrained sky-to-sand linear gradient plus a low-opacity radial highlight.
- Inner width: `min(calc(100% - 2 * var(--page-gutter)), var(--content-width))`.
- Desktop `.home-weather-music__grid`: `grid-template-columns: minmax(18rem, .72fr) minmax(0, 1.28fr)`.
- Mobile breakpoint at `760px`: one column with weather before music.
- Keep the existing weather dark-glass and music warm-paper visual language by moving only their relevant selectors from `src/pages/now.astro`.
- Do not include full-viewport height, header-height padding, clock/window/sea rail selectors, day-part variables, or global homepage theme overrides.
- Add `scroll-margin-top: calc(var(--header-height) + 1rem)` to the root.

- [ ] **Step 4: Extract the clock-free client initializer**

Create `src/scripts/home-weather-music.ts` by moving the `WeatherSnapshot`, `WeatherNotes`, weather mapping, fetch/geolocation, and music click-handler code out of `src/scripts/now-page.ts`.

Use this root and session key:

```ts
const section = document.querySelector<HTMLElement>("[data-home-weather-music]");
const geolocationSessionKey = "home-weather-geolocation-attempted";
```

Every selector must query from `section`. Do not query `[data-now-time]`, `[data-now-date]`, or `[data-now-greeting]`; do not set `document.documentElement.dataset.dayPart`; do not create an interval or visibility listener.

Preserve these observable behaviors:

```ts
const endpoint = section.dataset.weatherEndpoint ?? "/api/weather/";
const frame = player.querySelector<HTMLElement>("[data-player-frame]");
const iframe = document.createElement("iframe");
iframe.loading = "lazy";
iframe.allow = "autoplay; encrypted-media";
frame.replaceChildren(iframe);
```

Delete `src/scripts/now-page.ts` after the new initializer contains all weather and music behavior.

- [ ] **Step 5: Wire the section into the existing homepage**

In `src/pages/index.astro`:

```astro
import HomeWeatherMusic from "../components/home/HomeWeatherMusic.astro";
import { getDatabase } from "../lib/cloudflare/bindings";
import { listEnabledMusicTracks } from "../lib/database/music-repository";
```

Load tracks alongside the existing runtime values:

```ts
const [profile, editorial, tracks] = await Promise.all([
  loadRuntimeProfile(),
  loadRuntimeEditorial(),
  listEnabledMusicTracks(getDatabase()),
]);
```

Remove the previous two-value `Promise.all`, and insert exactly one new line after the closing `</aside>` for `.site-status`:

```astro
<HomeWeatherMusic tracks={tracks} content={editorial.nowPage} />
```

Do not edit the existing HomeHero, status, FeaturedPosts, TopicBand, FeaturedProjects, or HomeIntroduction component calls.

Change `src/components/now/WeatherPanel.astro` to `data-home-section="weather"` and `src/components/now/MusicPlayer.astro` to `data-home-section="music"`. Rename `data-now-vinyl` to `data-music-vinyl` in the component and client initializer.

- [ ] **Step 6: Replace the old page with a permanent redirect and remove clock-only code**

Replace `src/pages/now.astro` with:

```astro
---
return Astro.redirect("/#weather-music", 308);
---
```

Delete `src/components/now/NowClock.astro` because no route renders it.

- [ ] **Step 7: Run checks and focused browser tests for GREEN**

Run:

```powershell
npm run check
npx playwright test tests/e2e/home-weather-music.spec.ts tests/e2e/home.spec.ts --project=desktop-1440 --project=mobile-390
```

Expected: type checking passes; homepage weather/music, redirect, single iframe, mobile order, 44 px target, and no-overflow assertions pass.

- [ ] **Step 8: Commit the homepage integration**

```powershell
git add src/components/home/HomeWeatherMusic.astro src/scripts/home-weather-music.ts src/components/now/WeatherPanel.astro src/components/now/MusicPlayer.astro src/pages/index.astro src/pages/now.astro tests/e2e/home-weather-music.spec.ts tests/e2e/home.spec.ts
git add -u src/components/now/NowClock.astro src/scripts/now-page.ts tests/e2e/now.spec.ts
git commit -m "feat: add weather and music to homepage"
```

---

### Task 3: Consolidate weather copy and music management under page content

**Files:**
- Create: `src/components/admin/AdminMusicManager.astro`
- Modify: `src/pages/admin/content.astro`
- Replace: `src/pages/admin/music.astro`
- Modify: `src/components/admin/AdminShell.astro`
- Modify: `src/scripts/admin-music.ts`
- Modify: `src/scripts/admin-settings.ts`
- Modify: `src/styles/admin.css`
- Modify: `tests/e2e/admin.spec.ts`

**Interfaces:**
- Consumes: `listMusicTracks(database): Promise<AdminMusicTrack[]>`, existing `/api/admin/music/**`, `[data-setting-key="now_page"]`, and AdminLayout's global script imports.
- Produces: `AdminMusicManager.astro` with root `id="home-weather-music" data-music-page`; `/admin/content/` renders both settings and music CRUD; old admin URL redirects permanently.

- [ ] **Step 1: Change the admin E2E test first**

In the existing `administrator manages music tracks and cover images` test, replace sidebar navigation with:

```ts
await loginAsAdministrator(page);
await page.getByRole("link", { name: "页面内容", exact: true }).click();
await expect(page.getByRole("heading", { level: 1, name: "页面内容" })).toBeVisible();
const homepageSettings = page.getByRole("button", { name: "首页天气与音乐" });
await expect(homepageSettings).toBeVisible();
await homepageSettings.click();
await expect(page.locator("[data-setting-editor]")).toHaveAttribute("data-setting-key", "now_page");
await expect(page.locator("#home-weather-music")).toBeVisible();
```

After editing the first record, before saving it, add this regression sequence:

```ts
await page.getByRole("button", { name: "新增歌曲" }).click();
await expect(page.getByLabel("歌曲名称")).toHaveValue("");
await expect(page.getByLabel("歌手")).toHaveValue("");
await expect(page.getByLabel("网易云歌曲 ID")).toHaveValue("");
await firstRow.getByRole("button", { name: `编辑 ${firstTitle}` }).click();
```

Add a separate test:

```ts
test("legacy music admin route redirects to page content", async ({ page }) => {
  await loginAsAdministrator(page);
  await page.goto("/admin/music/");
  await expect(page).toHaveURL(/\/admin\/content\/#home-weather-music$/);
  await expect(page.locator("#home-weather-music")).toBeVisible();
await expect(page.getByRole("link", { name: "音乐", exact: true })).toHaveCount(0);
});
```

For the `mobile-390` project, add:

```ts
const widths = await page.evaluate(() => ({
  client: document.documentElement.clientWidth,
  scroll: document.documentElement.scrollWidth,
}));
expect(widths.scroll).toBeLessThanOrEqual(widths.client);
```

- [ ] **Step 2: Run the focused admin test and verify RED**

Run:

```powershell
npx playwright test tests/e2e/admin.spec.ts --grep "music|音乐" --project=desktop-1440
```

Expected: the test fails because the manager is still a standalone page and `now_page` is not listed in page content.

- [ ] **Step 3: Extract the reusable music manager component**

Create `src/components/admin/AdminMusicManager.astro` with:

```astro
---
import {
  ArrowDown,
  ArrowUp,
  Disc3,
  ImagePlus,
  Pencil,
  Plus,
  Save,
  Trash2,
  X,
} from "lucide-astro";
import type { AdminMusicTrack } from "../../lib/database/music-repository";

interface Props {
  tracks: AdminMusicTrack[];
}

const { tracks } = Astro.props;
---

<section id="home-weather-music" class="admin-content-music" aria-labelledby="home-music-heading">
  <div class="admin-panel__header">
    <div>
      <h2 id="home-music-heading">首页音乐</h2>
      <p>维护首页展示的网易云选曲、封面、推荐语和顺序。</p>
    </div>
  </div>
  <div class="admin-split admin-music" data-music-page>
    <section class="admin-panel admin-music__list">
      <div class="admin-panel__header">
        <div>
          <h3>选曲列表</h3>
          <p>共 {tracks.length} 首；启用歌曲会按此顺序出现在首页。</p>
        </div>
        <button class="admin-button admin-button--primary" type="button" data-create-music>
          <Plus size={16} />新增歌曲
        </button>
      </div>
    </section>
  </div>
</section>
```

Inside the list section and the sibling editor, move the existing table, rows, form, cover controls, and `data-music-records` JSON from `src/pages/admin/music.astro` without changing their field names, API-related data attributes, accessible labels, or row action data attributes. Keep the editor inside the same `[data-music-page]` root so every `page.querySelector` in `admin-music.ts` resolves correctly.

- [ ] **Step 4: Embed settings and music management in page content**

In `src/pages/admin/content.astro`, import and load tracks:

```astro
import AdminMusicManager from "../../components/admin/AdminMusicManager.astro";
import { getDatabase } from "../../lib/cloudflare/bindings";
import { listMusicTracks } from "../../lib/database/music-repository";

const tracks = await listMusicTracks(getDatabase());
```

Add this exact settings tuple after `homepage`:

```ts
["now_page", "首页天气与音乐"]
```

Wrap the existing settings form in an `admin-panel`, keep all existing data attributes, then render:

```astro
<AdminMusicManager tracks={tracks} />
```

after the settings panel. Update the AdminShell description to `维护首页、天气音乐、个人资料、导航和其他页面文案。`.

- [ ] **Step 5: Remove the standalone admin navigation and redirect the old page**

In `src/components/admin/AdminShell.astro`:

- Remove the `Music2` import.
- Remove `"music"` from the `active` union.
- Remove `{ key: "music", label: "音乐", href: "/admin/music/", icon: Music2 }`.

Replace `src/pages/admin/music.astro` with:

```astro
---
return Astro.redirect("/admin/content/#home-weather-music", 308);
---
```

- [ ] **Step 6: Make the admin script robust inside the embedded component**

Keep `const page = document.querySelector<HTMLElement>("[data-music-page]");` and the existing page-scoped listeners. Because the new-button now lives inside the root, retain:

```ts
page.querySelector<HTMLElement>("[data-create-music]")?.addEventListener("click", () => {
  void resetForm().then(() => input("title").focus()).catch((error: unknown) => {
    setStatus(status, error instanceof Error ? error.message : "新建歌曲失败。", true);
  });
});
```

No music API URLs or serialized field names change.

Add readable labels for the `now_page` JSON fields in `src/scripts/admin-settings.ts`:

```ts
const fieldLabels: Record<string, string> = {
  name: "昵称",
  siteTitle: "站点副标题",
  description: "站点简介",
  bio: "个人简介",
  avatar: "头像路径",
  occupation: "职业 / 身份",
  location: "所在地",
  motto: "个性签名",
  email: "联系邮箱",
  website: "个人网站",
  seoDescription: "搜索摘要",
  eyebrow: "英文眉题",
  title: "标题",
  weatherNotes: "天气寄语",
  music: "音乐文案",
  clear: "晴朗",
  cloudy: "多云",
  rain: "下雨",
  snow: "下雪",
  storm: "雷暴",
  fallback: "不可用时",
  emptyTitle: "空状态标题",
  emptyDescription: "空状态说明",
  openLabel: "网易云外链文字",
};
```

Add these focused styles to `src/styles/admin.css`:

```css
.admin-content-music {
  scroll-margin-top: 1rem;
}

.admin-content-music > .admin-panel__header {
  margin-block: 1.5rem 1rem;
}

.admin-music__list .admin-panel__header {
  align-items: center;
}
```

At the existing mobile breakpoint, keep `.admin-split { grid-template-columns: 1fr; }` and verify the table wrapper remains horizontally contained.

- [ ] **Step 7: Run checks and focused admin E2E for GREEN**

Run:

```powershell
npm run check
npx playwright test tests/e2e/admin.spec.ts --grep "music|音乐" --project=desktop-1440 --project=mobile-390
```

Expected: page-content integration, full CRUD, cover lifecycle, reset regression, redirect, removed sidebar entry, and mobile layout tests pass.

- [ ] **Step 8: Commit the admin consolidation**

```powershell
git add src/components/admin/AdminMusicManager.astro src/pages/admin/content.astro src/pages/admin/music.astro src/components/admin/AdminShell.astro src/scripts/admin-music.ts src/scripts/admin-settings.ts src/styles/admin.css tests/e2e/admin.spec.ts
git commit -m "refactor: consolidate homepage music management"
```

---

### Task 4: Update accessibility and route coverage

**Files:**
- Modify: `tests/e2e/accessibility.spec.ts`
- Modify: `tests/e2e/supporting-pages.spec.ts`
- Modify: `tests/e2e/home-weather-music.spec.ts`

**Interfaces:**
- Consumes: final homepage/admin DOM and permanent redirect behavior.
- Produces: representative accessibility coverage on the homepage and explicit legacy-route compatibility assertions.

- [ ] **Step 1: Change coverage tests first**

Remove `['此刻', '/now/']` from `representativePages` in `tests/e2e/accessibility.spec.ts`; the existing homepage Axe test now covers the integrated weather/music module.

Add to `tests/e2e/supporting-pages.spec.ts`:

```ts
test("legacy now route keeps old links working", async ({ request }) => {
  const response = await request.get("/now/", { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(response.headers().location).toBe("/#weather-music");
});

test("sitemap no longer advertises the standalone now page", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.ok()).toBe(true);
  expect(await response.text()).not.toContain("/now/");
});
```

Add to `tests/e2e/home-weather-music.spec.ts` after locating the module:

```ts
await expect(page.locator("#weather-music")).toHaveAttribute("aria-label", "天气与音乐");
await expect(page.locator("#weather-music iframe")).toHaveCount(0);
```

- [ ] **Step 2: Run the coverage tests**

Run:

```powershell
npx playwright test tests/e2e/accessibility.spec.ts tests/e2e/supporting-pages.spec.ts tests/e2e/home-weather-music.spec.ts --project=desktop-1440 --project=mobile-390
```

Expected before all implementation is present: redirect or integrated accessibility assertions fail. Expected after Tasks 1–3: all selected tests pass with zero Axe violations.

- [ ] **Step 3: Fix only issues demonstrated by the tests**

If Axe reports a violation, change the smallest responsible element in `HomeWeatherMusic.astro`, `WeatherPanel.astro`, `MusicPlayer.astro`, or `AdminMusicManager.astro`. Preserve the public data attributes and labels defined in Tasks 2 and 3.

If the redirect assertion reports an absolute `Location` header, normalize the test with:

```ts
expect(new URL(response.headers().location).pathname).toBe("/");
expect(new URL(response.headers().location).hash).toBe("#weather-music");
```

- [ ] **Step 4: Re-run the same coverage tests for GREEN**

Run the Step 2 command again.

Expected: all selected tests pass and Axe reports `violations: []`.

- [ ] **Step 5: Commit test coverage and any demonstrated fixes**

```powershell
git add tests/e2e/accessibility.spec.ts tests/e2e/supporting-pages.spec.ts tests/e2e/home-weather-music.spec.ts src/components/home/HomeWeatherMusic.astro src/components/now/WeatherPanel.astro src/components/now/MusicPlayer.astro src/components/admin/AdminMusicManager.astro
git commit -m "test: cover integrated homepage weather and music"
```

---

### Task 5: Full regression verification

**Files:**
- Verify only; modify files only when a failing command identifies a regression caused by Tasks 1–4.

**Interfaces:**
- Consumes: the complete implementation.
- Produces: fresh evidence for type safety, unit/worker behavior, production build, responsive browser behavior, accessibility, and a clean repository state.

- [ ] **Step 1: Verify formatting and repository consistency**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only intentional uncommitted verification fixes, if any, are listed.

- [ ] **Step 2: Run all unit and worker tests**

Run:

```powershell
npm test
```

Expected: all unit and Workers test files pass with zero failures.

- [ ] **Step 3: Run static checks and production build**

Run:

```powershell
npm run check
npm run build
```

Expected: Astro check and TypeScript report zero errors; build exits with code 0. Existing documented gray-matter direct-eval, unused seed helper, Zod passthrough deprecation, and Wrangler upgrade notices may remain if their text is unchanged.

- [ ] **Step 4: Run the focused desktop and mobile browser suites**

Run:

```powershell
npx playwright test tests/e2e/home.spec.ts tests/e2e/home-weather-music.spec.ts tests/e2e/admin.spec.ts tests/e2e/accessibility.spec.ts tests/e2e/supporting-pages.spec.ts --project=desktop-1440 --project=mobile-390
```

Expected: all applicable tests pass; database-writing tests may be skipped only where their existing project guards require one viewport.

- [ ] **Step 5: Verify D1 cleanup state**

Run:

```powershell
npx wrangler d1 execute zhaozhao-blog --local --command "SELECT COUNT(*) AS music_tracks FROM music_tracks; SELECT COUNT(*) AS cleanup_jobs FROM media_cleanup_jobs;"
```

Expected after E2E cleanup: `music_tracks = 0` and `cleanup_jobs = 0`.

- [ ] **Step 6: Confirm clean state**

If a verification command fails, do not continue to the completion claim. Return to the task that owns the failing behavior, add or tighten its regression test, perform a fresh red-green cycle, and use that task's explicit commit command.

Run:

```powershell
git status --short --branch
git log -6 --oneline
```

Expected: the worktree is clean on `codex/post-image-lifecycle`, and the recent history contains the navigation, homepage, admin, and coverage commits.
