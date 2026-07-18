# Header Weather and Music Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add compact desktop weather beside the site brand and searchable song selection inside the persistent navigation music player.

**Architecture:** A small shared browser-safe helper module owns weather formatting and music keyword matching. `HeaderWeather.astro` and its client script reuse `/api/weather/`; `HeaderMusicPlayer.astro` renders the already-loaded enabled tracks and its existing persistent controller handles filtering and selection.

**Tech Stack:** Astro 7, TypeScript 6, Vitest, Playwright, Cloudflare Workers/D1

## Global Constraints

- Keep the existing homepage weather/music card and homepage content unchanged.
- Reuse `/api/weather/`, the header's enabled-track query, and existing music events.
- Show compact header weather on desktop only; hide it when navigation space is constrained and on mobile.
- Search locally by title, artist, and note; do not add an API or backend field.
- Preserve `transition:persist="site-music-player"` playback across navigation.
- Do not change third-party music copyright/playability behavior.

---

### Task 1: Browser-safe header widget helpers

**Files:**
- Create: `src/lib/header-widgets.ts`
- Create: `tests/unit/header-widgets.test.ts`

**Interfaces:**
- Produces: `compactWeatherSymbol(code: number): string`
- Produces: `compactWeatherText(area: string, temperature: number): string`
- Produces: `musicTrackMatchesQuery(track: SearchableMusicTrack, query: string): boolean`

- [ ] **Step 1: Write the failing unit tests**

```ts
import { describe, expect, it } from "vitest";
import { compactWeatherSymbol, compactWeatherText, musicTrackMatchesQuery } from "../../src/lib/header-widgets";

describe("header widget helpers", () => {
  it("formats compact weather", () => {
    expect(compactWeatherSymbol(0)).toBe("☼");
    expect(compactWeatherSymbol(63)).toBe("☂");
    expect(compactWeatherText("浙江省 杭州市", 27.6)).toBe("浙江省 杭州市 · 28°");
  });

  it("matches music keywords across metadata", () => {
    const track = { title: "风之子", artist: "旅行团乐队", note: "适合晚风" };
    expect(musicTrackMatchesQuery(track, "旅行团")).toBe(true);
    expect(musicTrackMatchesQuery(track, "晚 风")).toBe(true);
    expect(musicTrackMatchesQuery(track, "爵士")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `npx vitest run tests/unit/header-widgets.test.ts`

Expected: FAIL because `src/lib/header-widgets.ts` does not exist.

- [ ] **Step 3: Implement the minimal helper module**

```ts
export interface SearchableMusicTrack {
  title: string;
  artist: string;
  note?: string | null;
}

export function compactWeatherSymbol(code: number): string {
  if ([95, 96, 99].includes(code)) return "ϟ";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "❄";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "☂";
  if ([1, 2, 3, 45, 48].includes(code)) return "☁";
  return "☼";
}

export function compactWeatherText(area: string, temperature: number): string {
  return `${area} · ${Math.round(temperature)}°`;
}

function searchable(value: string): string {
  return value.toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}

export function musicTrackMatchesQuery(track: SearchableMusicTrack, query: string): boolean {
  const normalized = searchable(query);
  if (!normalized) return true;
  return searchable(`${track.title}${track.artist}${track.note ?? ""}`).includes(normalized);
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run tests/unit/header-widgets.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit helper and tests**

```bash
git add src/lib/header-widgets.ts tests/unit/header-widgets.test.ts
git commit -m "test: cover header widget formatting"
```

### Task 2: Compact persistent header weather

**Files:**
- Create: `src/components/layout/HeaderWeather.astro`
- Create: `src/scripts/header-weather.ts`
- Modify: `src/components/layout/Header.astro`
- Test: `tests/e2e/home-weather-music.spec.ts`

**Interfaces:**
- Consumes: `compactWeatherSymbol` and `compactWeatherText` from Task 1.
- Consumes: `GET /api/weather/` returning `{ data: { area, code, temperature } }`.
- Produces: `[data-header-weather]` with a clickable refresh button and desktop-only presentation.

- [ ] **Step 1: Add a failing browser test**

Add a Playwright case that mocks `**/api/weather**` with `area: "杭州市"`, `code: 1`, and `temperature: 27.6`; verify `[data-header-weather]` contains `杭州市 · 28°` at desktop width and is hidden at 390px width.

- [ ] **Step 2: Run the focused browser test and verify it fails**

Run: `npx playwright test tests/e2e/home-weather-music.spec.ts --grep "header weather" --project=chromium`

Expected: FAIL because `[data-header-weather]` is absent.

- [ ] **Step 3: Create the weather component**

Render a `button` with `data-header-weather`, `data-weather-endpoint="/api/weather/"`, `transition:persist="site-header-weather"`, a symbol span, a text span initialized to `正在获取天气`, and restrained typography matching the header. Hide at `max-width: 1120px` and ensure overlay/light/dark states inherit readable current color.

- [ ] **Step 4: Implement the weather controller**

On initialization, fetch the endpoint with `cache: "no-store"`; update the symbol/text through Task 1 helpers; retain the last successful value on later failures; show `天气暂不可用` only before any success; refresh every ten minutes while visible; and refresh immediately when the button is clicked.

- [ ] **Step 5: Mount the component beside the brand**

Import `HeaderWeather` in `Header.astro`, render it immediately after `.site-brand`, and keep `.desktop-nav { margin-inline-start: auto; }` so the widget occupies only existing blank space.

- [ ] **Step 6: Run the focused browser test**

Run: `npx playwright test tests/e2e/home-weather-music.spec.ts --grep "header weather" --project=chromium`

Expected: PASS.

- [ ] **Step 7: Commit the weather widget**

```bash
git add src/components/layout/HeaderWeather.astro src/scripts/header-weather.ts src/components/layout/Header.astro tests/e2e/home-weather-music.spec.ts
git commit -m "feat: add compact weather to desktop header"
```

### Task 3: Searchable navigation song selection

**Files:**
- Modify: `src/components/layout/HeaderMusicPlayer.astro`
- Modify: `src/scripts/header-music-player.ts`
- Test: `tests/e2e/home-weather-music.spec.ts`

**Interfaces:**
- Consumes: `tracks: AdminMusicTrack[]` already loaded and sorted by `Header.astro`.
- Consumes: `musicTrackMatchesQuery` from Task 1.
- Produces: `[data-header-music-search]`, `[data-header-track]`, and `[data-header-music-empty]`.
- Continues producing: `site:music-select` and `site:music-change` events carrying `MusicSelection`.

- [ ] **Step 1: Add failing browser coverage**

Extend the seeded music test to navigate away from `/`, open `[data-header-music-trigger]`, filter using `[data-header-music-search]`, choose the matching `[data-header-track]`, and verify the iframe, compact title, and `aria-pressed` state update without returning home. Also verify an unmatched query displays `[data-header-music-empty]`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx playwright test tests/e2e/home-weather-music.spec.ts --grep "selects and searches music from any page" --project=chromium`

Expected: FAIL because the search input and header song buttons are absent.

- [ ] **Step 3: Render search and tracks in the player panel**

After the current player frame, render a search input when tracks exist, followed by buttons containing track id, title, artist, note, embed URL and external URL data attributes. Keep track rows compact, use a scroll container with a bounded height, add visible selected and hover states, and render a dedicated no-results message.

- [ ] **Step 4: Extend the persistent player controller**

Delegate clicks on `[data-header-track]` to `selectTrack`; mark the current row with `aria-pressed="true"`; filter rows on search input using `musicTrackMatchesQuery`; toggle the empty result; and clear the query only when explicitly requested, not on Astro page swaps, so the persistent component retains its state.

- [ ] **Step 5: Verify desktop and mobile behavior**

At desktop width, confirm the dropdown stays aligned to the action area. At mobile width, confirm the fixed panel stays inside the viewport, the list scrolls, and rows have at least a 44px touch height.

- [ ] **Step 6: Run focused browser and unit tests**

Run: `npx vitest run tests/unit/header-widgets.test.ts && npx playwright test tests/e2e/home-weather-music.spec.ts --project=chromium`

Expected: PASS.

- [ ] **Step 7: Commit searchable selection**

```bash
git add src/components/layout/HeaderMusicPlayer.astro src/scripts/header-music-player.ts tests/e2e/home-weather-music.spec.ts
git commit -m "feat: select and search music from header"
```

### Task 4: Integration verification

**Files:**
- Modify only if verification exposes a scoped defect.

**Interfaces:**
- Verifies all interfaces from Tasks 1–3 without introducing new behavior.

- [ ] **Step 1: Run static checks**

Run: `npm run check`

Expected: zero Astro or TypeScript errors.

- [ ] **Step 2: Run automated tests**

Run: `npm test`

Expected: all unit and worker tests pass.

- [ ] **Step 3: Run focused end-to-end tests**

Run: `npx playwright test tests/e2e/home-weather-music.spec.ts --project=chromium`

Expected: all focused tests pass.

- [ ] **Step 4: Inspect the final diff**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and only planned files plus the user's untouched `../.codegraph/` entry.
