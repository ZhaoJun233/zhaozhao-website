# Hero Weather Music Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move weather and music into a hideable translucent Hero drawer, correct precise-location names with reverse geocoding, refresh weather every ten minutes while open, and let administrators populate song metadata and a managed cover from a NetEase song ID.

**Architecture:** `HomeHero.astro` gains a named slot and owns only placement; `HomeWeatherMusic.astro` owns the drawer markup and visual treatment; `home-weather-music.ts` owns drawer state, player interaction, and weather refresh lifecycle. The weather Worker adds fixed-host reverse geocoding, while a new authenticated music-metadata endpoint fetches NetEase metadata and imports allowed cover images through the existing draft media lifecycle.

**Tech Stack:** Astro 7, TypeScript 6, Cloudflare Workers, D1, KV media storage, Cache API, Vitest, Playwright, Axe, lucide-astro.

## Global Constraints

- Keep the existing Hero title, description, typing line, action buttons, artwork, petals, scroll cue, site-status strip, and all content below it.
- Render the weather/music drawer inside the Hero; remove the separate block between site status and featured posts.
- Desktop defaults open; screens at or below 899 px default closed; stored `hero-weather-music-open` preference overrides the responsive default.
- Closed state keeps an existing NetEase iframe alive but makes panel controls inert and unfocusable.
- Initial page load never creates or autoplays an iframe.
- Precise coordinates use BigDataCloud reverse geocoding; reverse-geocode failure displays `当前位置`, never the Cloudflare IP city.
- Cloudflare/fallback coordinates continue to use existing city/fallback labels without reverse geocoding.
- Weather refreshes immediately on opening, every 600,000 ms while open and visible, and after visibility restoration when stale.
- Closing the drawer cancels future refresh timers and starts no new location requests.
- NetEase metadata uses only `https://music.163.com/api/song/detail?ids=[ID]`; cover downloads allow only HTTPS `music.126.net` or subdomains.
- Metadata failure never removes manual music administration; note, enabled state, sort order, and record ID are not overwritten.
- Downloaded covers use the existing draft media asset, cleanup, sharing, and save lifecycle.
- No coordinates, place names, or weather history are persisted in D1, KV, or localStorage.
- Preserve API, `music_tracks`, BlogBackupV3, and media reference compatibility.
- Run browser tests with the existing single-worker shared-D1 configuration.

---

### Task 1: Add precise reverse geocoding to the weather route

**Files:**
- Modify: `src/lib/weather.ts`
- Modify: `src/pages/api/weather.ts`
- Modify: `tests/unit/weather.test.ts`
- Modify: `tests/workers/weather.test.ts`

**Interfaces:**
- Produces: `fetchReverseGeocode(input: ReverseGeocodeInput): Promise<string>`, `reverseGeocodeCacheKey(latitude: number, longitude: number): string`, and precise-coordinate weather responses whose `area` matches the submitted coordinates.
- Preserves: `fetchWeatherSnapshot`, `normalizeCoordinates`, `/api/weather/` response shape, ten-minute weather cache, and fixed Open-Meteo host.

- [ ] **Step 1: Write failing reverse-geocoding unit tests**

Add to `tests/unit/weather.test.ts`:

```ts
import {
  fetchReverseGeocode,
  reverseGeocodeCacheKey,
} from "../../src/lib/weather";

it("formats a Chinese locality and city from BigDataCloud", async () => {
  const fetcher = vi.fn(async () => Response.json({
    locality: "徐汇区",
    city: "上海市",
    principalSubdivision: "上海市",
  }));

  await expect(fetchReverseGeocode({
    latitude: 31.1837,
    longitude: 121.4365,
    fetcher: fetcher as typeof fetch,
  })).resolves.toBe("徐汇区 · 上海市");

  const url = new URL(String(fetcher.mock.calls[0]![0]));
  expect(url.origin).toBe("https://api.bigdatacloud.net");
  expect(url.pathname).toBe("/data/reverse-geocode-client");
  expect(url.searchParams.get("localityLanguage")).toBe("zh");
});

it("uses a stable 0.02 degree reverse-geocode cache grid", () => {
  expect(reverseGeocodeCacheKey(31.1837, 121.4365))
    .toBe(reverseGeocodeCacheKey(31.1841, 121.4361));
  expect(reverseGeocodeCacheKey(31.1837, 121.4365))
    .not.toBe(reverseGeocodeCacheKey(31.2041, 121.4565));
});
```

- [ ] **Step 2: Update Worker tests for precise and fallback area behavior**

In `tests/workers/weather.test.ts`, change the precise-coordinate fetcher to return BigDataCloud data for that origin and Open-Meteo data otherwise:

```ts
const fetcher = vi.fn(async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  fetched.push(url.toString());
  if (url.origin === "https://api.bigdatacloud.net") {
    return Response.json({
      locality: "徐汇区",
      city: "上海市",
      principalSubdivision: "上海市",
    });
  }
  return weatherUpstream();
});
```

Assert the precise response uses the reverse-geocoded area despite `cf.city = "杭州"`:

```ts
expect(await response.json()).toMatchObject({
  data: { area: "徐汇区 · 上海市", condition: "多云", temperature: 28.4 },
});
```

Add tests that:

```ts
expect(reverseFetches).toBe(1);
expect(secondPreciseResponse.data.area).toBe("徐汇区 · 上海市");
expect(reverseFailureResponse.data.area).toBe("当前位置");
expect(cloudflareFallbackResponse.data.area).toBe("杭州");
```

- [ ] **Step 3: Run tests for RED**

Run:

```powershell
npx vitest run tests/unit/weather.test.ts
npx vitest run --config vitest.workers.config.ts tests/workers/weather.test.ts
```

Expected: missing reverse-geocode exports and the old precise response area `杭州` cause failures.

- [ ] **Step 4: Implement reverse-geocoding helpers**

Add to `src/lib/weather.ts`:

```ts
const reverseGeocodeSchema = z.object({
  locality: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  principalSubdivision: z.string().trim().max(120).optional().nullable(),
});

export interface ReverseGeocodeInput {
  latitude: number;
  longitude: number;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export function reverseGeocodeCacheKey(latitude: number, longitude: number): string {
  const coordinates = normalizeCoordinates(latitude, longitude);
  return `reverse:${Math.round(coordinates.latitude / 0.02)}:${Math.round(coordinates.longitude / 0.02)}`;
}

export async function fetchReverseGeocode({
  latitude,
  longitude,
  fetcher = fetch,
  timeoutMs = 5_000,
}: ReverseGeocodeInput): Promise<string> {
  normalizeCoordinates(latitude, longitude);
  const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("localityLanguage", "zh");
  const response = await fetcher(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`BigDataCloud returned ${response.status}.`);
  const value = reverseGeocodeSchema.parse(await response.json());
  const locality = value.locality?.trim();
  const city = value.city?.trim();
  if (locality && city && locality !== city) return `${locality} · ${city}`;
  return locality || city || value.principalSubdivision?.trim() || "当前位置";
}
```

- [ ] **Step 5: Distinguish coordinate sources and cache reverse results**

In `src/pages/api/weather.ts`, make `routeCoordinates()` return:

```ts
type LocationSource = "precise" | "cloudflare" | "fallback";

{
  latitude: number;
  longitude: number;
  area: string;
  source: LocationSource;
}
```

For query coordinates use `source: "precise"` and initial `area: "当前位置"`; for Cloudflare coordinates use `source: "cloudflare"` and `cf.city`; for the existing Hangzhou fallback use `source: "fallback"` and `访客所在区域`.

Add a reverse cache request using `reverseGeocodeCacheKey`, with cached responses carrying `cache-control: public, max-age=3600`. Before calling `fetchWeatherSnapshot`, resolve the precise area as follows:

```ts
let area = location.area;
if (location.source === "precise") {
  try {
    area = await resolvePreciseArea(location.latitude, location.longitude, activeCache, fetcher);
  } catch {
    area = "当前位置";
  }
}
const snapshot = await fetchWeatherSnapshot({ ...location, area, fetcher });
```

- [ ] **Step 6: Run focused tests for GREEN and commit**

Run the Step 3 commands. Expected: all weather unit and Worker tests pass.

```powershell
git add src/lib/weather.ts src/pages/api/weather.ts tests/unit/weather.test.ts tests/workers/weather.test.ts
git commit -m "feat: reverse geocode precise weather"
```

---

### Task 2: Add the authenticated NetEase metadata and managed-cover service

**Files:**
- Create: `src/lib/netease-metadata.ts`
- Create: `src/pages/api/admin/music/metadata.ts`
- Modify: `src/lib/admin/schemas.ts`
- Create: `tests/unit/netease-metadata.test.ts`
- Create: `tests/workers/music-metadata.test.ts`

**Interfaces:**
- Produces: `musicMetadataInputSchema`, `fetchNeteaseSongMetadata`, `isAllowedNeteaseCoverUrl`, `importNeteaseSongMetadata`, and authenticated `POST /api/admin/music/metadata/`.
- Consumes: `uploadPostImage(database, store, file, { draftToken })`, `getMediaStore()`, `handleAdminRequest()`, and the existing draft cleanup lifecycle.

- [ ] **Step 1: Write failing metadata parsing and allowlist tests**

Create `tests/unit/netease-metadata.test.ts` with tests for:

```ts
expect(isAllowedNeteaseCoverUrl("https://p1.music.126.net/cover.jpg")).toBe(true);
expect(isAllowedNeteaseCoverUrl("https://music.126.net/cover.jpg")).toBe(true);
expect(isAllowedNeteaseCoverUrl("http://p1.music.126.net/cover.jpg")).toBe(false);
expect(isAllowedNeteaseCoverUrl("https://music.126.net.evil.example/cover.jpg")).toBe(false);
```

Mock the song detail response and assert:

```ts
await expect(fetchNeteaseSongMetadata("347230", fetcher as typeof fetch))
  .resolves.toEqual({
    title: "海阔天空",
    artist: "Beyond / 黄家驹",
    coverSourceUrl: "https://p1.music.126.net/cover.jpg",
  });
```

- [ ] **Step 2: Write failing managed-cover Worker tests**

Create `tests/workers/music-metadata.test.ts`. Inject a memory metadata cache and a fetcher that returns song JSON and a small `image/jpeg` response. Assert:

```ts
expect(result).toMatchObject({
  title: "海阔天空",
  artist: "Beyond",
  coverAssetId: expect.any(String),
  coverUrl: expect.stringMatching(/^\/media\/uploads\//),
  warning: undefined,
});
const stored = await env.DB.prepare("SELECT kv_key FROM media_assets WHERE id = ?")
  .bind(result.coverAssetId)
  .first<{ kv_key: string }>();
expect(await env.MEDIA.get(stored!.kv_key, "arrayBuffer")).not.toBeNull();
```

Add cases for metadata cache reuse, missing songs, invalid cover host, cover fetch failure returning title/artist plus a warning, and a draft cleanup deleting an automatically imported cover.

- [ ] **Step 3: Run tests for RED**

Run:

```powershell
npx vitest run tests/unit/netease-metadata.test.ts
npx vitest run --config vitest.workers.config.ts tests/workers/music-metadata.test.ts
```

Expected: imports and service functions do not exist.

- [ ] **Step 4: Add the input schema and metadata service**

Add to `src/lib/admin/schemas.ts`:

```ts
export const musicMetadataInputSchema = z.object({
  neteaseSongId: text.regex(/^\d{1,20}$/, "网易云歌曲 ID 只能填写数字。"),
  draftToken: uuid,
});

export type MusicMetadataInput = z.infer<typeof musicMetadataInputSchema>;
```

Create `src/lib/netease-metadata.ts` with these public types:

```ts
export interface NeteaseSongMetadata {
  title: string;
  artist: string;
  coverSourceUrl?: string;
}

export interface ImportedNeteaseSongMetadata {
  title: string;
  artist: string;
  coverAssetId?: string;
  coverUrl?: string;
  warning?: string;
}

export interface MetadataCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}
```

Use a Zod schema for `songs[0].name`, `artists[].name`, and `album.picUrl`. Build only this fixed URL:

```ts
const url = new URL("https://music.163.com/api/song/detail");
url.searchParams.set("ids", JSON.stringify([songId]));
```

Use a five-second timeout, a browser-like `User-Agent`, `Referer: https://music.163.com/`, and a 24-hour internal Cache API entry keyed only by validated song ID.

- [ ] **Step 5: Import the optional cover through the existing media lifecycle**

Implement:

```ts
export async function importNeteaseSongMetadata({
  database,
  store,
  input,
  fetcher = fetch,
  cache,
}: ImportNeteaseSongMetadataOptions): Promise<ImportedNeteaseSongMetadata>
```

Parse `input` with `musicMetadataInputSchema`. Fetch metadata first. If the cover is absent, invalid, non-HTTPS, larger than 5 MiB, unsupported, or fails to download, return title/artist and `warning: "歌曲信息已获取，封面请手动上传。"` without throwing.

For a valid cover, create:

```ts
const file = new File([bytes], `netease-${neteaseSongId}`, {
  type: contentType,
});
const asset = await uploadPostImage(database, store, file, { draftToken });
```

Return `coverAssetId: asset.id` and `coverUrl: asset.url`; do not expose the internal KV key in the API result.

- [ ] **Step 6: Add the authenticated API route**

Create `src/pages/api/admin/music/metadata.ts`:

```ts
import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import { getMediaStore } from "../../../../lib/cloudflare/bindings";
import { importNeteaseSongMetadata } from "../../../../lib/netease-metadata";

export const POST: APIRoute = ({ request }) => handleAdminRequest(
  request,
  async (database) => importNeteaseSongMetadata({
    database,
    store: getMediaStore(),
    input: await readAdminJson(request),
  }),
);
```

- [ ] **Step 7: Run focused tests for GREEN and commit**

Run the Step 3 commands. Expected: all metadata unit and Worker tests pass.

```powershell
git add src/lib/netease-metadata.ts src/pages/api/admin/music/metadata.ts src/lib/admin/schemas.ts tests/unit/netease-metadata.test.ts tests/workers/music-metadata.test.ts
git commit -m "feat: import NetEase song metadata"
```

---

### Task 3: Move the weather/music presentation into a Hero drawer

**Files:**
- Modify: `src/components/home/HomeHero.astro`
- Modify: `src/components/home/HomeWeatherMusic.astro`
- Modify: `src/components/now/WeatherPanel.astro`
- Modify: `src/components/now/MusicPlayer.astro`
- Modify: `src/pages/index.astro`
- Modify: `tests/e2e/home.spec.ts`
- Modify: `tests/e2e/home-weather-music.spec.ts`

**Interfaces:**
- Produces: named Hero slot `weather-music`, root `#weather-music`, toggle `[data-weather-music-toggle]`, panel `#hero-weather-music-panel`, and `data-drawer-open` state.
- Preserves: `data-home-weather-music`, weather/player data attributes, one iframe, current song DOM, and existing homepage content calls.

- [ ] **Step 1: Write failing layout and toggle tests**

In `tests/e2e/home.spec.ts`, assert the drawer is inside `.home-hero`, and no direct sibling block remains after `.site-status`:

```ts
await expect(page.locator(".home-hero #weather-music")).toHaveCount(1);
await expect(page.locator(".site-status + #weather-music")).toHaveCount(0);
```

In `tests/e2e/home-weather-music.spec.ts`, add desktop assertions:

```ts
const toggle = page.locator("[data-weather-music-toggle]");
await expect(toggle).toHaveAttribute("aria-controls", "hero-weather-music-panel");
await expect(toggle).toHaveAttribute("aria-expanded", "true");
await expect(page.locator("#hero-weather-music-panel")).not.toHaveAttribute("inert", "");
```

For `mobile-390`, assert default closed, 44×44 toggle size, inert panel, then click and assert open. Add a reload test that sets the drawer closed on desktop, reloads, and confirms the stored preference wins.

- [ ] **Step 2: Run browser tests for RED**

Run:

```powershell
npm run build
npx playwright test tests/e2e/home.spec.ts tests/e2e/home-weather-music.spec.ts --project=desktop-1440 --project=mobile-390
```

Expected: drawer placement, toggle, stored state, and mobile closed-state assertions fail.

- [ ] **Step 3: Add the Hero slot and move the component call**

In `HomeHero.astro`, place the named slot inside `<section class="home-hero">` after `.hero-copy`:

```astro
<slot name="weather-music" />
```

In `src/pages/index.astro`, replace the standalone calls with:

```astro
<HomeHero>
  <HomeWeatherMusic
    slot="weather-music"
    tracks={tracks}
    content={editorial.nowPage}
  />
</HomeHero>
```

Keep `.site-status` followed immediately by `<FeaturedPosts posts={homePosts} />`.

- [ ] **Step 4: Replace the full-width section with drawer markup**

Change `HomeWeatherMusic.astro` to this hierarchy:

```astro
<section id="weather-music" class="hero-weather-music" data-home-weather-music>
  <button
    class="hero-weather-music__toggle"
    type="button"
    aria-controls="hero-weather-music-panel"
    aria-expanded="true"
    data-weather-music-toggle
  >隐藏天气音乐</button>
  <div
    id="hero-weather-music-panel"
    class="hero-weather-music__panel"
    data-weather-music-panel
  >
    <WeatherPanel notes={content.hero.weatherNotes} />
    <MusicPlayer tracks={tracks} content={content.music} />
    <p class="hero-weather-music__privacy">位置仅用于天气与地名查询，不会保存。</p>
  </div>
  <script is:inline type="application/json" data-weather-notes set:html={JSON.stringify(content.hero.weatherNotes)}></script>
</section>
```

Keep the existing script import.

- [ ] **Step 5: Implement exact drawer styling**

Use absolute desktop placement:

```css
.hero-weather-music {
  position: absolute;
  z-index: 5;
  right: max(1.5rem, calc((100vw - var(--content-width)) / 2));
  bottom: 4.5rem;
  width: clamp(20rem, 30vw, 27rem);
}

.hero-weather-music__panel {
  max-height: 58vh;
  overflow: auto;
  border: 1px solid rgb(255 255 255 / 48%);
  border-radius: 1rem;
  background: rgb(248 248 244 / 62%);
  box-shadow: 0 24px 70px rgb(24 50 58 / 18%);
  backdrop-filter: blur(20px) saturate(1.08);
}
```

At `max-width: 899px`, anchor the root to the artwork with `right: 1rem; bottom: 1rem; left: 1rem; width: auto`, default the enhanced panel closed, and cap open height at `70svh`. Toggle minimum size is 44×44. Use `data-drawer-open="false"` to apply opacity, visibility, pointer-events, and transform without `display: none`, so an iframe remains alive.

Restyle weather and music as a compact vertical drawer: no large section heading, temperature no larger than 3.25rem, player vinyl no larger than 4.5rem, track list capped at 12rem with internal scrolling. Preserve AA contrast in light/dark themes.

- [ ] **Step 6: Add drawer state behavior to the client script**

At the top of `home-weather-music.ts`, read the toggle and panel, then implement:

```ts
const drawerStorageKey = "hero-weather-music-open";
const mobileQuery = window.matchMedia("(max-width: 899px)");

function storedDrawerState(): boolean | undefined {
  const value = localStorage.getItem(drawerStorageKey);
  return value === "true" ? true : value === "false" ? false : undefined;
}

function setDrawerOpen(open: boolean, persist = true) {
  section.dataset.drawerOpen = String(open);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.textContent = open ? "隐藏天气音乐" : "天气 · 音乐";
  panel.toggleAttribute("inert", !open);
  if (persist) localStorage.setItem(drawerStorageKey, String(open));
}
```

Initialize with stored state or `!mobileQuery.matches`. Toggle on click. Do not remove the iframe on close.

- [ ] **Step 7: Run focused browser tests for GREEN and commit**

Run the Step 2 commands. Expected: all drawer placement, default-state, persistence, focus, responsive, iframe, and original Hero assertions pass.

```powershell
git add src/components/home/HomeHero.astro src/components/home/HomeWeatherMusic.astro src/components/now/WeatherPanel.astro src/components/now/MusicPlayer.astro src/pages/index.astro src/scripts/home-weather-music.ts tests/e2e/home.spec.ts tests/e2e/home-weather-music.spec.ts
git commit -m "feat: add Hero weather music drawer"
```

---

### Task 4: Make drawer weather refresh while visible and preserve successful data

**Files:**
- Modify: `src/scripts/home-weather-music.ts`
- Modify: `src/components/now/WeatherPanel.astro`
- Modify: `tests/e2e/home-weather-music.spec.ts`

**Interfaces:**
- Consumes: Task 3 `setDrawerOpen`, panel open state, `/api/weather/`, weather data attributes.
- Produces: ten-minute refresh timer, visibility/reopen refresh, no new hidden requests, and `data-weather-refresh-status` feedback.

- [ ] **Step 1: Write failing refresh lifecycle tests**

In `home-weather-music.spec.ts`, use `page.clock.install()` before navigation. For mobile, assert no weather request occurs before opening. After opening, assert the precise request occurs. Fast-forward 600,000 ms and assert a new request. Close, fast-forward another 600,000 ms, and assert the count does not change. Reopen and assert immediate refresh.

Add a test where the first weather response succeeds and the next responds 503. Assert temperature and area remain from the successful response while `[data-weather-refresh-status]` displays `更新暂时失败`.

- [ ] **Step 2: Run the focused test for RED**

Run:

```powershell
npm run build
npx playwright test tests/e2e/home-weather-music.spec.ts --project=desktop-1440 --project=mobile-390
```

Expected: weather still requests while mobile is initially closed, has no timer, and overwrites successful state on failure.

- [ ] **Step 3: Add refresh status markup**

In `WeatherPanel.astro`, add:

```astro
<span class="now-weather__status" data-weather-refresh-status aria-live="polite"></span>
```

Keep it visually compact and reserve one text line to avoid layout jumps.

- [ ] **Step 4: Refactor weather loading into an open-state lifecycle**

Use:

```ts
const weatherRefreshMs = 10 * 60 * 1000;
let refreshTimer: number | undefined;
let lastWeatherSuccess = 0;
let hasWeatherSnapshot = false;
let preciseLocationUnavailable = false;
```

`showWeather()` sets `hasWeatherSnapshot = true`, updates `lastWeatherSuccess`, and clears status. On failure, if a snapshot exists only set status to `更新暂时失败`; otherwise show the existing fallback condition/note.

Implement `refreshWeather()` so it returns immediately when the drawer is closed or the document is hidden. Query geolocation permission; when denied or unavailable, request the fallback endpoint once. When allowed, use `getCurrentPosition` and request precise coordinates; on a location error mark precise location unavailable for the session and use fallback weather.

Implement `startWeatherRefresh()` and `stopWeatherRefresh()` using one `window.setInterval`. Opening calls refresh immediately and starts the timer. Closing clears it. `visibilitychange` refreshes when visible, open, and `Date.now() - lastWeatherSuccess >= weatherRefreshMs`.

- [ ] **Step 5: Run focused tests for GREEN and commit**

Run the Step 2 command. Expected: refresh lifecycle and preserved-success tests pass.

```powershell
git add src/scripts/home-weather-music.ts src/components/now/WeatherPanel.astro tests/e2e/home-weather-music.spec.ts
git commit -m "feat: refresh visible Hero weather"
```

---

### Task 5: Add the admin song-metadata action and stale-response protection

**Files:**
- Modify: `src/components/admin/AdminMusicManager.astro`
- Modify: `src/scripts/admin-music.ts`
- Modify: `tests/e2e/admin.spec.ts`

**Interfaces:**
- Consumes: `POST /api/admin/music/metadata/`, existing `formGeneration`, `draftToken`, `coverAssetId`, `showCover`, and `cleanupDraft` logic.
- Produces: `[data-fetch-music-metadata]` button and `[data-music-metadata-status]` feedback without changing the saved music payload.

- [ ] **Step 1: Write failing admin metadata tests**

In `admin.spec.ts`, intercept `/api/admin/music/metadata/` and assert clicking “自动获取歌曲信息” sends the current ID/token, fills title/artist, updates managed cover fields, and preserves note/enabled/record ID.

Add failure coverage that returns 503 and asserts all existing values remain. Add a delayed-response test: start metadata fetch, click “新增歌曲”, enter new values, release the old response, and assert it does not overwrite the new form; assert the old draft cleanup request completes.

- [ ] **Step 2: Run admin tests for RED**

Run:

```powershell
npm run build
npx playwright test tests/e2e/admin.spec.ts --grep "music metadata|歌曲信息" --project=desktop-1440
```

Expected: metadata button and request handling do not exist.

- [ ] **Step 3: Add metadata controls**

In `AdminMusicManager.astro`, place this button beside the song-ID help text:

```astro
<button class="admin-button" type="button" data-fetch-music-metadata>
  自动获取歌曲信息
</button>
<p class="admin-status" data-music-metadata-status aria-live="polite"></p>
```

The button remains inside `[data-music-page]` and is at least 44 px high on mobile.

- [ ] **Step 4: Implement request and stale-response isolation**

In `admin-music.ts`, capture `formGeneration` and `draftToken` before the request. Disable only the metadata button while active. Send:

```ts
body: JSON.stringify({
  neteaseSongId: input("neteaseSongId").value.trim(),
  draftToken: requestedDraftToken,
})
```

If the response belongs to the current generation/token, set title and artist. Only replace the cover when both `coverAssetId` and `coverUrl` exist. Preserve note, enabled, ID, and sort state. Display a returned warning without treating metadata success as failure.

If the response is stale, do not touch UI; call `cleanupDraft(requestedDraftToken)` after it settles so a late imported cover cannot leak. Increment generation and clear metadata status during reset/populate operations.

- [ ] **Step 5: Run admin tests for GREEN and commit**

Run the Step 2 command, then the existing music CRUD and delayed-upload tests. Expected: all pass.

```powershell
git add src/components/admin/AdminMusicManager.astro src/scripts/admin-music.ts tests/e2e/admin.spec.ts
git commit -m "feat: auto-fill NetEase song details"
```

---

### Task 6: Accessibility and full regression verification

**Files:**
- Modify only when a failing verification proves a regression in Tasks 1–5.

**Interfaces:**
- Consumes: complete implementation.
- Produces: fresh evidence for unit, Worker, build, responsive, accessibility, media cleanup, and repository state.

- [ ] **Step 1: Run all unit and Worker tests**

```powershell
npm test
```

Expected: all unit and Worker tests pass, including new weather and music-metadata files.

- [ ] **Step 2: Run static checks and production build**

```powershell
npm run check
npm run build
```

Expected: zero errors; only the existing four hints and gray-matter direct-eval warning remain.

- [ ] **Step 3: Run focused desktop/mobile browser coverage**

```powershell
npx playwright test tests/e2e/home.spec.ts tests/e2e/home-weather-music.spec.ts tests/e2e/admin.spec.ts tests/e2e/accessibility.spec.ts --project=desktop-1440 --project=mobile-390
```

Expected: drawer, weather lifecycle, metadata, admin CRUD, Hero regression, and Axe tests pass; existing viewport guards may skip write tests on mobile.

- [ ] **Step 4: Verify cleanup state and Git status**

```powershell
npx wrangler d1 execute zhaozhao-blog --local --command "SELECT COUNT(*) AS music_tracks FROM music_tracks; SELECT COUNT(*) AS cleanup_jobs FROM media_cleanup_jobs;"
git diff --check
git status --short --branch
```

Expected: `music_tracks = 0`, `cleanup_jobs = 0`, no whitespace errors, and no tracked uncommitted files. The existing root `.codegraph/` remains untracked and untouched.

- [ ] **Step 5: Commit a verification fix only if a failing test required one**

If a regression appears, reproduce it with the narrowest failing test, make one minimal correction, rerun that test and Steps 1–4, then commit the exact corrected files with:

```powershell
git commit -m "fix: finalize Hero weather music drawer"
```
