# Mizuki Anime Personal Blog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, responsive Astro personal blog with an uncropped anime hero, validated Markdown content, strong discovery, polished reading interactions, and production-grade search, feeds, comments states, accessibility, and tests.

**Architecture:** Astro 7 statically renders every content and feature route from typed Content Collections. Focused server-side helpers own sorting, taxonomy, pagination, related content, dates, and SEO; small framework-free browser controllers add theme, navigation, search, reading progress, code copy, filters, and lazy Giscus loading. Pagefind indexes the completed `dist` directory after the Astro build.

**Tech Stack:** Astro 7.0.9, TypeScript 7.0.2, native CSS, `lucide-astro` 0.556.0, `@astrojs/sitemap` 3.7.3, `@astrojs/rss` 4.0.19, Pagefind 1.5.2, Vitest 4.1.10, Playwright 1.61.1, `@axe-core/playwright` 4.12.1, and Lighthouse CI 0.15.1.

## Global Constraints

- Repository root: `E:/ShortTime/shortTimeSpace`; project root: `E:/ShortTime/shortTimeSpace/mizuki-blog`; do not modify `reverse`.
- Runtime: Node 24.14.0 or newer; package manager: npm.
- Site output is static, `base: "/"`, `trailingSlash: "always"`, language `zh-CN`, timezone `Asia/Shanghai`.
- Use no Tailwind, React/Vue/Svelte integration, state library, particle library, or custom backend.
- Desktop hero must show the complete source image; below 900px, place hero copy below the 16:9 image.
- Use the user hero and only the selected Bilibili cover; record the exact source metadata from the design spec.
- Client JavaScript is limited to navigation, theme, search, code copy, reading progress, project filters, and lazy Giscus.
- All decorative motion must stop under `prefers-reduced-motion: reduce`.
- Target WCAG 2.2 AA, zero serious/critical Axe violations, median mobile LCP below 2.5s, and CLS below 0.1.
- Run commands from `E:/ShortTime/shortTimeSpace/mizuki-blog` unless a step states otherwise.

---

## File Map

```text
mizuki-blog/
  astro.config.mjs                 # Static build, site URL, sitemap, Markdown settings
  package.json                     # Scripts and pinned dependencies
  playwright.config.ts             # Preview-backed cross-viewport browser tests
  lighthouserc.cjs                  # Three-run mobile performance budget
  tsconfig.json                    # Strict Astro TypeScript configuration
  vitest.config.ts                 # Unit-test configuration
  .env.example                     # Public site and optional Giscus variables
  public/
    favicon.svg                    # Brand mark
    manifest.webmanifest           # Install metadata
  src/
    assets/backgrounds/            # Home and About source artwork
    components/
      blog/                        # Post cards, metadata, TOC, comments, related posts
      integrations/                # Pagefind and Giscus boundaries
      layout/                      # Header, mobile navigation, footer
      project/                     # Project cards and filter controls
      seo/SeoHead.astro            # Meta and structured data
      ui/                          # Icons, buttons, theme and search controls
    config/site.ts                 # Typed site identity and feature configuration
    content/posts/                 # Six demonstration Markdown posts
    content/projects/              # Three demonstration Markdown projects
    content.config.ts              # Post/project collection schemas
    data/                           # Friends, timeline, artwork metadata
    layouts/BaseLayout.astro       # HTML shell and global controllers
    layouts/PostLayout.astro       # Article reading shell
    lib/content.ts                 # Sort, filter, pagination, related and archive helpers
    lib/date.ts                    # Stable zh-CN formatting
    lib/seo.ts                     # Canonical, JSON-LD and breadcrumb helpers
    lib/slug.ts                    # Deterministic taxonomy slugging
    pages/                          # Route contract from the design spec
    scripts/                        # Focused framework-free browser controllers
    styles/                         # Tokens, global layout, prose and motion styles
  tests/
    e2e/                            # Workflows, screenshots and Axe
    unit/                           # Domain and SEO helper tests
```

---

### Task 1: Bootstrap The Astro Project And Site Contract

**Files:**
- Create: `package.json`
- Create: `astro.config.mjs`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `src/env.d.ts`
- Create: `src/config/site.ts`
- Create: `tests/unit/site-config.test.ts`

**Interfaces:**
- Produces: `siteConfig: SiteConfig`, containing `name`, `title`, `description`, `locale`, `timeZone`, `siteUrl`, `pageSize`, `author`, `navigation`, and `giscus`.
- Consumes: `PUBLIC_SITE_URL` and the four optional public Giscus variables.

- [ ] **Step 1: Create the package manifest**

```json
{
  "name": "mizuki-blog",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "astro dev",
    "check": "astro check && tsc --noEmit",
    "build": "astro build && pagefind --site dist",
    "preview": "astro preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "test:a11y": "playwright test tests/e2e/accessibility.spec.ts"
  },
  "dependencies": {
    "@astrojs/rss": "4.0.19",
    "@astrojs/sitemap": "3.7.3",
    "astro": "7.0.9",
    "lucide-astro": "0.556.0",
    "pagefind": "1.5.2"
  },
  "devDependencies": {
    "@astrojs/check": "0.9.9",
    "@axe-core/playwright": "4.12.1",
    "@lhci/cli": "0.15.1",
    "@playwright/test": "1.61.1",
    "typescript": "7.0.2",
    "vitest": "4.1.10"
  }
}
```

- [ ] **Step 2: Install the pinned dependencies**

Run: `npm install`

Expected: `package-lock.json` is created and `npm ls --depth=0` exits 0.

- [ ] **Step 3: Install the Chromium test browser**

Run: `npx playwright install chromium`

Expected: Playwright reports Chromium installed or already present and exits 0.

- [ ] **Step 4: Write the failing site-contract test**

```ts
import { describe, expect, it } from "vitest";
import { siteConfig } from "../../src/config/site";

describe("siteConfig", () => {
  it("uses the Chinese locale and stable route contract", () => {
    expect(siteConfig.locale).toBe("zh-CN");
    expect(siteConfig.timeZone).toBe("Asia/Shanghai");
    expect(siteConfig.pageSize).toBe(8);
    expect(siteConfig.navigation.map((item) => item.href)).toEqual([
      "/", "/posts/", "/categories/", "/archive/", "/projects/",
      "/friends/", "/about/", "/guestbook/"
    ]);
  });
});
```

- [ ] **Step 5: Run the test and verify the missing module failure**

Run: `npm test -- tests/unit/site-config.test.ts`

Expected: FAIL because `src/config/site.ts` does not exist.

- [ ] **Step 6: Implement configuration and Astro build settings**

```ts
// src/config/site.ts
export type NavigationItem = { label: string; href: string };
export type SiteConfig = {
  name: string;
  title: string;
  description: string;
  locale: "zh-CN";
  timeZone: "Asia/Shanghai";
  siteUrl: string;
  pageSize: 8;
  author: { name: string; bio: string; email?: string };
  navigation: NavigationItem[];
  giscus: { repo?: string; repoId?: string; category?: string; categoryId?: string };
};

export const siteConfig: SiteConfig = {
  name: "Mizuki.",
  title: "Mizuki. - 动画、代码与生活碎片",
  description: "记录动画、开发与日常灵感的个人博客。",
  locale: "zh-CN",
  timeZone: "Asia/Shanghai",
  siteUrl: import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321",
  pageSize: 8,
  author: { name: "Mizuki", bio: "在动画、代码与海风之间记录生活。" },
  navigation: [
    { label: "首页", href: "/" }, { label: "文章", href: "/posts/" },
    { label: "分类", href: "/categories/" }, { label: "归档", href: "/archive/" },
    { label: "项目", href: "/projects/" }, { label: "友链", href: "/friends/" },
    { label: "关于", href: "/about/" }, { label: "留言", href: "/guestbook/" }
  ],
  giscus: {
    repo: import.meta.env.PUBLIC_GISCUS_REPO,
    repoId: import.meta.env.PUBLIC_GISCUS_REPO_ID,
    category: import.meta.env.PUBLIC_GISCUS_CATEGORY,
    categoryId: import.meta.env.PUBLIC_GISCUS_CATEGORY_ID
  }
};
```

Configure `astro.config.mjs` with `output: "static"`, `site: process.env.PUBLIC_SITE_URL ?? "http://localhost:4321"`, `base: "/"`, `trailingSlash: "always"`, `sitemap()`, and Shiki light/dark themes. Extend `astro/tsconfigs/strict` in `tsconfig.json`. Configure Vitest for `tests/unit/**/*.test.ts`.

- [ ] **Step 7: Run configuration verification**

Run: `npm test -- tests/unit/site-config.test.ts && npm run check`

Expected: the unit test passes; Astro check reports no errors.

- [ ] **Step 8: Commit the bootstrap**

```powershell
git add mizuki-blog/package.json mizuki-blog/package-lock.json mizuki-blog/astro.config.mjs mizuki-blog/tsconfig.json mizuki-blog/vitest.config.ts mizuki-blog/.env.example mizuki-blog/src/env.d.ts mizuki-blog/src/config/site.ts mizuki-blog/tests/unit/site-config.test.ts
git commit -m "chore: bootstrap Astro blog"
```

---

### Task 2: Implement Content Schemas And Domain Utilities

**Files:**
- Create: `src/content.config.ts`
- Create: `src/lib/content.ts`
- Create: `src/lib/date.ts`
- Create: `src/lib/slug.ts`
- Create: `tests/unit/content.test.ts`
- Create: `tests/unit/slug.test.ts`

**Interfaces:**
- Produces: `taxonomySlug(value)`, `sortPosts(posts)`, `estimateReadingMinutes(text)`, `groupPostsByMonth(posts)`, `paginate(items, page, size)`, and `getRelatedPosts(current, candidates, limit)`.
- Produces collections named `posts` and `projects`.

- [ ] **Step 1: Write failing utility tests**

```ts
import { describe, expect, it } from "vitest";
import { taxonomySlug } from "../../src/lib/slug";
import { estimateReadingMinutes, getRelatedPosts, paginate } from "../../src/lib/content";

describe("content domain", () => {
  it("keeps Chinese taxonomy readable and normalizes punctuation", () => {
    expect(taxonomySlug(" 动画 / 随笔 ")).toBe("动画-随笔");
  });
  it("uses mixed Chinese and Latin reading speed", () => {
    expect(estimateReadingMinutes("海".repeat(400) + " word ".repeat(200))).toBe(2);
  });
  it("paginates deterministically", () => {
    expect(paginate([1, 2, 3, 4, 5], 2, 2)).toEqual({ items: [3, 4], page: 2, pageCount: 3, total: 5 });
  });
  it("scores category before one shared tag", () => {
    const current = { id: "a", publishedAt: new Date("2026-07-15"), category: "开发", tags: ["Astro"] };
    const related = getRelatedPosts(current, [
      { id: "b", publishedAt: new Date("2026-07-14"), category: "开发", tags: [] },
      { id: "c", publishedAt: new Date("2026-07-13"), category: "随笔", tags: ["Astro"] }
    ], 3);
    expect(related.map((item) => item.id)).toEqual(["b", "c"]);
  });
});
```

- [ ] **Step 2: Verify the domain tests fail**

Run: `npm test -- tests/unit/content.test.ts tests/unit/slug.test.ts`

Expected: FAIL because the helper modules do not exist.

- [ ] **Step 3: Implement deterministic domain helpers**

Implement `taxonomySlug` using `normalize("NFKC")`, lowercase ASCII, replacement of punctuation/whitespace runs with `-`, and edge trimming. Implement the exact reading-time and related-score rules from the design spec. `paginate` throws `RangeError` when `page < 1`, `size < 1`, or `page > pageCount` for non-empty data.

```ts
export function estimateReadingMinutes(text: string): number {
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
  const latin = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu, " ").match(/[\p{L}\p{N}_'-]+/gu)?.length ?? 0;
  return Math.max(1, Math.ceil(cjk / 400 + latin / 200));
}
```

- [ ] **Step 4: Define Astro content schemas**

Use `glob({ pattern: "**/*.md", base: "./src/content/posts" })` and the equivalent projects loader. The post schema enforces one category, 1-8 normalized unique tags, `coverAlt` when `cover` exists, and defaults `draft`/`featured` to false. The project schema enforces status and 1-6 unique tags.

- [ ] **Step 5: Run domain and schema checks**

Run: `npm test -- tests/unit && npm run check`

Expected: all tests pass; collection configuration has no type errors.

- [ ] **Step 6: Commit the content domain**

```powershell
git add mizuki-blog/src/content.config.ts mizuki-blog/src/lib mizuki-blog/tests/unit/content.test.ts mizuki-blog/tests/unit/slug.test.ts
git commit -m "feat: add typed content domain"
```

---

### Task 3: Add Artwork, Typed Site Data, And Demonstration Content

**Files:**
- Create: `src/assets/backgrounds/home-hero.png`
- Create: `src/assets/backgrounds/about-summer-dream.jpg`
- Create: `src/data/artwork.ts`
- Create: `src/data/friends.ts`
- Create: `src/data/timeline.ts`
- Create: six files under `src/content/posts/`
- Create: three files under `src/content/projects/`
- Create: `tests/unit/data.test.ts`

**Interfaces:**
- Produces: `artwork.homeHero`, `artwork.aboutSummerDream`, `friends`, and `timeline`.
- Content consumers may assume six published posts, three projects, four friend entries, and four timeline entries.

- [ ] **Step 1: Acquire and verify the two approved images**

```powershell
New-Item -ItemType Directory -Force src/assets/backgrounds | Out-Null
Copy-Item -LiteralPath 'D:\Users\zhao\Desktop\AIGC\修图.png' -Destination 'src\assets\backgrounds\home-hero.png'
Invoke-WebRequest -Uri 'https://i1.hdslb.com/bfs/archive/c439b38012563ee914ecb97bcad4155773c3ccf0.jpg' -Headers @{ Referer='https://www.bilibili.com/'; 'User-Agent'='Mozilla/5.0' } -OutFile 'src\assets\backgrounds\about-summer-dream.jpg'
(Get-FileHash 'src\assets\backgrounds\about-summer-dream.jpg' -Algorithm SHA256).Hash
```

Expected hash: `A70CDC0597270E2A0336C5D7E9A556B0CBF53F49F69A26235475B21C46CAA094`.

- [ ] **Step 2: Write failing typed-data tests**

```ts
import { describe, expect, it } from "vitest";
import { artwork } from "../../src/data/artwork";
import { friends } from "../../src/data/friends";
import { timeline } from "../../src/data/timeline";

describe("site data", () => {
  it("records the selected Bilibili source exactly", () => {
    expect(artwork.aboutSummerDream.bvid).toBe("BV1NCjx6oEhj");
    expect(artwork.aboutSummerDream.placements).toEqual(["home-intro", "about-hero"]);
  });
  it("ships the specified demonstration data counts", () => {
    expect(friends).toHaveLength(4);
    expect(timeline).toHaveLength(4);
  });
});
```

- [ ] **Step 3: Implement typed site data**

`artwork.ts` records local imports, alt text, source URL, uploader `清水未萌_Minamo`, BV id, and placements. Friends use fictional `.example` URLs and render with a visible demonstration-data notice. Timeline entries describe creating the blog, starting animation notes, publishing development notes, and opening the guestbook.

- [ ] **Step 4: Add realistic demonstration content**

Create these posts with 500-900 Chinese characters each, headings, lists, links, one fenced code block in development posts, and complete frontmatter:

1. `summer-anime-notes.md` - `七月动画随记：把喜欢的片段留住`
2. `astro-content-collections.md` - `用 Astro Content Collections 整理个人写作`
3. `quiet-weekend.md` - `一个安静周末的光影与歌单`
4. `css-motion-notes.md` - `克制的网页动画：让界面呼吸而不打扰`
5. `reading-workflow.md` - `我的长文阅读与摘录流程`
6. `blog-design-log.md` - `这间网络小屋的设计记录`

Create projects `anime-watchlist.md`, `photo-notes.md`, and `mizuki-blog.md` with active/completed states and honest demonstration repository/demo links omitted.

- [ ] **Step 5: Run data and collection verification**

Run: `npm test -- tests/unit/data.test.ts && npm run check`

Expected: tests pass and all nine entries satisfy collection schemas.

- [ ] **Step 6: Commit content and approved artwork**

```powershell
git add mizuki-blog/src/assets mizuki-blog/src/data mizuki-blog/src/content mizuki-blog/tests/unit/data.test.ts
git commit -m "content: add artwork and sample writing"
```

---

### Task 4: Build The Design System, SEO Shell, Header, And Footer

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/global.css`
- Create: `src/styles/prose.css`
- Create: `src/layouts/BaseLayout.astro`
- Create: `src/components/seo/SeoHead.astro`
- Create: `src/components/layout/Header.astro`
- Create: `src/components/layout/MobileNav.astro`
- Create: `src/components/layout/Footer.astro`
- Create: `src/components/ui/ThemeToggle.astro`
- Create: `src/scripts/theme.ts`
- Create: `src/scripts/navigation.ts`
- Create: `src/lib/seo.ts`
- Create: `tests/unit/seo.test.ts`

**Interfaces:**
- Produces: `BaseLayout` props `{ title, description, image?, type?, jsonLd? }`.
- Produces: `buildCanonical(path)`, `buildWebsiteJsonLd()`, and `buildBlogPostingJsonLd(post)`.

- [ ] **Step 1: Write failing SEO tests**

```ts
import { describe, expect, it } from "vitest";
import { buildCanonical, buildWebsiteJsonLd } from "../../src/lib/seo";

describe("seo", () => {
  it("builds canonical URLs with trailing slashes", () => {
    expect(buildCanonical("/posts/hello")).toBe("http://localhost:4321/posts/hello/");
  });
  it("declares a Chinese website schema", () => {
    expect(buildWebsiteJsonLd().inLanguage).toBe("zh-CN");
  });
});
```

- [ ] **Step 2: Verify SEO tests fail, then implement helpers**

Run: `npm test -- tests/unit/seo.test.ts`

Expected before implementation: FAIL on missing module. Implement URL normalization and typed JSON-LD, then rerun for PASS.

- [ ] **Step 3: Implement design tokens and global styles**

Define separate neutral, cyan, pink, success, warning, border, overlay, focus, and shadow tokens for light/dark modes. Use `--radius-card: 8px`, `--content-width: 1180px`, `--prose-width: 72ch`, and explicit focus rings. Add global reduced-motion overrides and stable media dimensions.

- [ ] **Step 4: Implement the HTML shell and theme bootstrap**

`BaseLayout` renders `<html lang="zh-CN">`, `SeoHead`, skip link, Header, main slot, and Footer. An inline head script reads `localStorage.getItem("mizuki-theme")`, resolves `system`, and applies `data-theme` before CSS paint. `theme.ts` updates the attribute, control state, and storage.

- [ ] **Step 5: Implement responsive navigation**

Use Lucide `Search`, `SunMoon`, `Menu`, `X`, and `ExternalLink` icons. The mobile dialog locks background scroll, traps Tab focus, closes on Escape/backdrop/navigation, and restores focus to the menu trigger. The desktop header changes from overlay to solid after 24px scroll.

- [ ] **Step 6: Verify the foundation**

Run: `npm test -- tests/unit/seo.test.ts && npm run check && npm run build`

Expected: all commands pass and generated HTML contains one `<main>`, one canonical link, and Chinese language metadata.

- [ ] **Step 7: Commit the foundation**

```powershell
git add mizuki-blog/src/styles mizuki-blog/src/layouts mizuki-blog/src/components/layout mizuki-blog/src/components/seo mizuki-blog/src/components/ui/ThemeToggle.astro mizuki-blog/src/scripts/theme.ts mizuki-blog/src/scripts/navigation.ts mizuki-blog/src/lib/seo.ts mizuki-blog/tests/unit/seo.test.ts
git commit -m "feat: add visual foundation and site shell"
```

---

### Task 5: Implement Content Cards, Taxonomies, Pagination, Archive, And Routes

**Files:**
- Create: `src/components/blog/PostCard.astro`
- Create: `src/components/blog/PostMeta.astro`
- Create: `src/components/blog/TagList.astro`
- Create: `src/components/blog/Pagination.astro`
- Create: `src/pages/posts/index.astro`
- Create: `src/pages/posts/page/[page].astro`
- Create: `src/pages/categories/index.astro`
- Create: `src/pages/categories/[slug].astro`
- Create: `src/pages/tags/index.astro`
- Create: `src/pages/tags/[slug].astro`
- Create: `src/pages/archive.astro`
- Extend: `tests/unit/content.test.ts`

**Interfaces:**
- Consumes: `sortPosts`, `paginate`, `taxonomySlug`, `groupPostsByMonth`.
- Produces: consistent `PostCard` props `{ post, prominence?: "featured" | "standard" | "compact" }`.

- [ ] **Step 1: Add failing archive and collision tests**

Test that December 2025 and January 2026 form separate Chinese month groups, page 2 of 17 items at size 8 contains items 9-16, and duplicate normalized taxonomy slugs throw an error naming both original values.

- [ ] **Step 2: Run focused tests and implement missing behavior**

Run: `npm test -- tests/unit/content.test.ts`

Expected: new assertions fail first, then pass after helper updates.

- [ ] **Step 3: Implement reusable article UI**

Post cards use optimized covers, stable aspect ratios, category, date, reading time, tags, description, and one clear title link. Featured cards use a wide editorial composition; compact archive rows do not become nested cards.

- [ ] **Step 4: Generate paginated and taxonomy routes**

Use `getStaticPaths()` to create only valid page/category/tag routes. Category/tag pages display title, count, compact article list, and an empty-state component for direct development fixtures. Ensure links use `encodeURI` and configured trailing slashes.

- [ ] **Step 5: Implement the archive**

Render years as sections and months as semantic lists. Each row contains date, title, category, and reading time. Do not wrap the archive band in a card.

- [ ] **Step 6: Verify generated routes**

Run: `npm test -- tests/unit/content.test.ts && npm run check && npm run build`

Expected: all commands pass; `dist/posts/`, category/tag routes, and `dist/archive/index.html` exist.

- [ ] **Step 7: Commit content discovery routes**

```powershell
git add mizuki-blog/src/components/blog mizuki-blog/src/pages/posts mizuki-blog/src/pages/categories mizuki-blog/src/pages/tags mizuki-blog/src/pages/archive.astro mizuki-blog/src/lib/content.ts mizuki-blog/tests/unit/content.test.ts
git commit -m "feat: add article discovery routes"
```

---

### Task 6: Build The Home Page And Approved Hero Experience

**Files:**
- Create: `src/components/home/HomeHero.astro`
- Create: `src/components/home/FeaturedPosts.astro`
- Create: `src/components/home/TopicBand.astro`
- Create: `src/components/home/FeaturedProjects.astro`
- Create: `src/components/home/HomeIntroduction.astro`
- Create: `src/scripts/hero-typing.ts`
- Create: `src/pages/index.astro`
- Create: `tests/e2e/home.spec.ts`

**Interfaces:**
- Consumes: `artwork.homeHero`, `artwork.aboutSummerDream`, sorted posts/projects, and site identity.
- Produces: landmarks and test ids `home-hero-image`, `hero-copy`, `featured-posts`, `home-introduction`.

- [ ] **Step 1: Configure Playwright and write the failing hero test**

```ts
import { expect, test } from "@playwright/test";

test("desktop hero keeps the complete source image visible", async ({ page }) => {
  await page.goto("/");
  const image = page.getByTestId("home-hero-image");
  await expect(image).toBeVisible();
  await expect(image).toHaveCSS("object-fit", "contain");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Mizuki");
});

test("mobile moves copy below the artwork", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const imageBox = await page.getByTestId("home-hero-image").boundingBox();
  const copyBox = await page.getByTestId("hero-copy").boundingBox();
  expect(copyBox!.y).toBeGreaterThanOrEqual(imageBox!.y + imageBox!.height - 1);
});
```

- [ ] **Step 2: Run the home test and verify route failure**

Run: `npm run build; npm run test:e2e -- tests/e2e/home.spec.ts`

Expected: FAIL because the home route and hero test ids do not exist.

- [ ] **Step 3: Implement the hero without image zoom**

Render a blurred `cover` duplicate as decorative fill and a foreground Astro `<Image>` with `object-fit: contain`. Desktop hero height uses `clamp(620px, 82svh, 800px)`. The 899px breakpoint makes the image a 16:9 band followed by copy. Petals and typing pause for reduced motion and when the document is hidden.

- [ ] **Step 4: Implement the complete home composition**

Render a visible hint of Featured Posts after the hero, three featured/recent posts, category shortcuts, up to three projects, the selected Bilibili artwork in Home Introduction with a restrained overlay, and a compact site-status strip. Keep page bands unframed and use cards only for repeated content.

- [ ] **Step 5: Run home verification at all target widths**

Run: `npm run check && npm run build && npm run test:e2e -- tests/e2e/home.spec.ts`

Expected: PASS at 320, 390, 768, 1440, and 1920 projects; no text/image overlap.

- [ ] **Step 6: Commit the home page**

```powershell
git add mizuki-blog/src/components/home mizuki-blog/src/scripts/hero-typing.ts mizuki-blog/src/pages/index.astro mizuki-blog/tests/e2e/home.spec.ts mizuki-blog/playwright.config.ts
git commit -m "feat: build immersive home page"
```

---

### Task 7: Build The Article Reading Experience

**Files:**
- Create: `src/layouts/PostLayout.astro`
- Create: `src/components/blog/TableOfContents.astro`
- Create: `src/components/blog/ReadingProgress.astro`
- Create: `src/components/blog/RelatedPosts.astro`
- Create: `src/components/blog/Comments.astro`
- Create: `src/components/integrations/Giscus.astro`
- Create: `src/scripts/article.ts`
- Create: `src/scripts/comments.ts`
- Create: `src/pages/posts/[...slug].astro`
- Create: `tests/e2e/article.spec.ts`

**Interfaces:**
- Consumes: rendered Markdown headings, `estimateReadingMinutes`, `getRelatedPosts`, and `siteConfig.giscus`.
- Produces: article body marked `data-pagefind-body`, Pagefind filters for category/tags, and comments configured/unconfigured states.

- [ ] **Step 1: Write failing article workflow tests**

Test that the Astro article opens, TOC links target existing headings, reading progress changes after scrolling, a code-copy button writes code to the clipboard, previous/next links are present, and missing Giscus values show `评论功能尚未配置` without loading `giscus.app/client.js`.

- [ ] **Step 2: Run the article tests and confirm failures**

Run: `npm run build; npm run test:e2e -- tests/e2e/article.spec.ts`

Expected: FAIL because the article route and enhancements are absent.

- [ ] **Step 3: Implement static article rendering**

Use `render(post)` for content/headings, derive reading time from body, add cover/metadata/updated date, accessible TOC, prose styles, related posts, previous/next posts, copy-link button, and JSON-LD. Sticky desktop TOC collapses into a native `<details>` block below 1024px.

- [ ] **Step 4: Implement progressive article controllers**

`article.ts` adds code-copy buttons with `复制代码`/`已复制` announcements, copy-link behavior, active TOC tracking, and a CSS custom property for reading progress. All actions remain absent or harmless without JavaScript.

- [ ] **Step 5: Implement lazy Giscus and its exact missing state**

`Giscus.astro` requires all four config values. When configured, `comments.ts` inserts one script at 600px root margin with pathname mapping; guestbook accepts fixed term `guestbook`. When unconfigured, render the specified Chinese status and `/credits/#giscus-setup` link.

- [ ] **Step 6: Verify article workflows and output**

Run: `npm run check && npm run build && npm run test:e2e -- tests/e2e/article.spec.ts`

Expected: all article tests pass; built HTML includes `BlogPosting` JSON-LD and Pagefind metadata.

- [ ] **Step 7: Commit the reading experience**

```powershell
git add mizuki-blog/src/layouts/PostLayout.astro mizuki-blog/src/components/blog mizuki-blog/src/components/integrations/Giscus.astro mizuki-blog/src/scripts/article.ts mizuki-blog/src/scripts/comments.ts mizuki-blog/src/pages/posts mizuki-blog/tests/e2e/article.spec.ts
git commit -m "feat: add polished article reading"
```

---

### Task 8: Implement Projects, Friends, About, Guestbook, Credits, Feeds, And Recovery

**Files:**
- Create: `src/components/project/ProjectCard.astro`
- Create: `src/components/project/ProjectFilters.astro`
- Create: `src/scripts/project-filters.ts`
- Create: project index/detail routes under `src/pages/projects/`
- Create: `src/pages/friends.astro`
- Create: `src/pages/about.astro`
- Create: `src/pages/guestbook.astro`
- Create: `src/pages/credits.astro`
- Create: `src/pages/404.astro`
- Create: `src/pages/rss.xml.ts`
- Create: `src/pages/robots.txt.ts`
- Create: `public/manifest.webmanifest`
- Create: `public/favicon.svg`
- Create: `tests/e2e/supporting-pages.spec.ts`

**Interfaces:**
- Consumes: typed projects, friends, timeline, artwork, `Giscus term="guestbook"`, and filtered published posts.
- Produces: all remaining route-contract pages and system output.

- [ ] **Step 1: Write failing supporting-page tests**

Test project status filtering, the four demonstration friend cards, About artwork source link, Guestbook missing Giscus state, Credits exact BV/source/uploader, 404 home/search recovery, RSS XML containing six posts, and `robots.txt` containing the configured sitemap URL.

- [ ] **Step 2: Run tests and verify missing-route failures**

Run: `npm run build; npm run test:e2e -- tests/e2e/supporting-pages.spec.ts`

Expected: route navigation or locator assertions fail.

- [ ] **Step 3: Implement project index and detail routes**

Use a segmented status control (`全部`, `进行中`, `已完成`, `已归档`) and vanilla filtering that updates `aria-pressed`, project visibility, and a live result count. Cards show only real configured repository/demo actions.

- [ ] **Step 4: Implement personal and community pages**

About uses the approved Bilibili cover with its focal point, profile, interests, tools, and four-event timeline. Friends shows a demonstration-data notice and accessible external cards. Guestbook reuses Giscus with fixed term. Credits lists both artwork records and a concrete four-variable Giscus setup guide.

- [ ] **Step 5: Implement recovery and generated assets**

404 offers home, search, and three recent posts. RSS uses the shared published/sorted content query. `robots.txt.ts` derives sitemap from `Astro.site`. Manifest and favicon use the Mizuki sea-cyan/sakura-pink identity without an SVG illustration.

- [ ] **Step 6: Verify every supporting route**

Run: `npm run check && npm run build && npm run test:e2e -- tests/e2e/supporting-pages.spec.ts`

Expected: tests pass and all route-contract files exist in `dist`.

- [ ] **Step 7: Commit supporting features**

```powershell
git add mizuki-blog/src/components/project mizuki-blog/src/scripts/project-filters.ts mizuki-blog/src/pages mizuki-blog/public mizuki-blog/tests/e2e/supporting-pages.spec.ts
git commit -m "feat: add projects and supporting pages"
```

---

### Task 9: Integrate Pagefind Search And Keyboard UX

**Files:**
- Create: `src/components/ui/SearchDialog.astro`
- Create: `src/components/integrations/PagefindSearch.astro`
- Create: `src/scripts/search.ts`
- Create: `src/pages/search.astro`
- Modify: `src/components/layout/Header.astro`
- Create: `tests/e2e/search.spec.ts`

**Interfaces:**
- Consumes: `/pagefind/pagefind.js`, Pagefind result objects, category filter, OR tag filters.
- Produces: global search dialog opened by header or `/`, and the `/search/` page using the same controller.

- [ ] **Step 1: Write failing production-search tests**

```ts
test("search finds Chinese article body text", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("/");
  await page.getByRole("searchbox").fill("Content Collections");
  await expect(page.getByRole("link", { name: /整理个人写作/ })).toBeVisible();
});
```

Also test Escape focus restoration, no-results copy, exact category filtering, OR tag filtering, and arrow-key result focus.

- [ ] **Step 2: Run after production build and verify failures**

Run: `npm run build && npm run test:e2e -- tests/e2e/search.spec.ts`

Expected: FAIL because search UI/controller is absent; confirm `dist/pagefind/pagefind.js` already exists.

- [ ] **Step 3: Implement lazy Pagefind adapter**

Import `/pagefind/pagefind.js` only when the dialog/page first receives input. Map `result.data()` into title, excerpt, URL, category, and tags. Debounce 120ms, abort stale renders with a monotonically increasing request id, and announce result counts through `aria-live`.

- [ ] **Step 4: Implement dialog and standalone search UX**

The dialog traps focus, closes on Escape/backdrop, restores the opener, and uses arrow keys between results. Header `/` shortcut ignores inputs, textareas, contenteditable elements, and modifier keys. `astro dev` catches import failure and displays `搜索索引将在生产构建后可用`; production preview must never show that notice.

- [ ] **Step 5: Verify search end to end**

Run: `npm run build && npm run test:e2e -- tests/e2e/search.spec.ts`

Expected: all search, filters, empty state, focus, and keyboard tests pass.

- [ ] **Step 6: Commit search**

```powershell
git add mizuki-blog/src/components/ui/SearchDialog.astro mizuki-blog/src/components/integrations/PagefindSearch.astro mizuki-blog/src/scripts/search.ts mizuki-blog/src/pages/search.astro mizuki-blog/src/components/layout/Header.astro mizuki-blog/tests/e2e/search.spec.ts
git commit -m "feat: add Pagefind search experience"
```

---

### Task 10: Add Accessibility, Responsive, And Visual Regression Coverage

**Files:**
- Create: `tests/e2e/accessibility.spec.ts`
- Create: `tests/e2e/responsive.spec.ts`
- Create: `tests/e2e/theme.spec.ts`
- Create: `tests/e2e/fixtures.ts`
- Modify: `playwright.config.ts`
- Modify: styles/components found by the tests

**Interfaces:**
- Consumes: stable test ids and all production routes.
- Produces: screenshots for 320x568, 390x844, 768x1024, 1440x900, 1920x1080, and manual 2560x1440 review.

- [ ] **Step 1: Add Axe tests for representative routes**

Run Axe on `/`, one article, `/posts/`, `/projects/`, `/about/`, `/search/`, and `/404.html`. Assert `impact === "serious" || impact === "critical"` yields an empty list. Exercise keyboard navigation before scanning dialogs.

- [ ] **Step 2: Add responsive geometry assertions**

For each target viewport, assert `document.documentElement.scrollWidth <= innerWidth`, header controls do not overlap, hero image/copy order matches the breakpoint, longest sample title remains inside its card, and article prose width is no more than 74ch. Capture full-page screenshots.

- [ ] **Step 3: Add theme persistence and reduced-motion tests**

Test light/dark/system selection, reload persistence, no pre-paint mismatch attribute, sufficient text/background contrast tokens, and that petals/typing have `animation-name: none` under reduced motion.

- [ ] **Step 4: Run the full browser suite and fix evidence-backed defects**

Run: `npm run build && npm run test:e2e`

Expected: all projects pass with no retries required. Inspect 1440, 390, and 2560 screenshots and verify the character head, next-section hint, About artwork, long titles, and dark-theme overlays.

- [ ] **Step 5: Commit cross-device quality fixes**

```powershell
git add mizuki-blog/tests/e2e mizuki-blog/playwright.config.ts mizuki-blog/src
git commit -m "test: verify accessibility and responsive UX"
```

---

### Task 11: Complete Production Audit, Documentation, And Preview

**Files:**
- Create: `README.md`
- Create: `docs/content-authoring.md`
- Create: `docs/deployment.md`
- Create: `scripts/verify-build.mjs`
- Create: `lighthouserc.cjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run verify`, a reproducible production audit, and author/deployment instructions.

- [ ] **Step 1: Implement the build verifier**

`scripts/verify-build.mjs` parses built files and exits nonzero unless all route-contract outputs exist, RSS is valid XML with six items, sitemap references content routes, Pagefind assets exist, no draft title appears in output, and every local HTML link resolves to a built file or valid fragment.

- [ ] **Step 2: Add the verification command**

Add `"verify": "npm run check && npm test && npm run build && node scripts/verify-build.mjs && npm run test:e2e"` and `"perf": "lhci autorun"` to `package.json`.

- [ ] **Step 3: Configure the measured performance budget**

```js
// lighthouserc.cjs
module.exports = {
  ci: {
    collect: {
      startServerCommand: "npm run preview -- --host 127.0.0.1 --port 4321",
      startServerReadyPattern: "localhost:4321|127.0.0.1:4321",
      url: ["http://127.0.0.1:4321/", "http://127.0.0.1:4321/posts/astro-content-collections/"],
      numberOfRuns: 3,
      settings: { formFactor: "mobile", throttlingMethod: "simulate" }
    },
    assert: {
      assertions: {
        "largest-contentful-paint": ["error", { maxNumericValue: 2500, aggregationMethod: "median-run" }],
        "cumulative-layout-shift": ["error", { maxNumericValue: 0.1, aggregationMethod: "median-run" }]
      }
    },
    upload: { target: "filesystem", outputDir: ".lighthouseci" }
  }
};
```

- [ ] **Step 4: Document authoring and deployment**

README covers install, dev, build, preview, verify, directory map, identity editing, and content replacement. `content-authoring.md` documents every frontmatter field with one complete post/project example. `deployment.md` documents `PUBLIC_SITE_URL`, four Giscus variables, static hosts, domain-root constraint, and the build command.

- [ ] **Step 5: Run the complete completion audit**

Run: `npm run verify && npm run perf`

Expected: Astro check, unit tests, production build, build verifier, all Playwright projects, screenshots, Axe checks, and three-run median Lighthouse budgets pass.

- [ ] **Step 6: Start the production preview and inspect runtime output**

Run: `npm run preview -- --host 127.0.0.1 --port 4321`

Expected: preview stays running at `http://127.0.0.1:4321/`; Pagefind search works, images render, and browser console contains no uncaught errors.

- [ ] **Step 7: Commit documentation and final audit**

```powershell
git add mizuki-blog/README.md mizuki-blog/docs mizuki-blog/scripts/verify-build.mjs mizuki-blog/lighthouserc.cjs mizuki-blog/package.json mizuki-blog/package-lock.json
git commit -m "docs: add authoring and deployment guide"
```

- [ ] **Step 8: Record final evidence**

Run: `git status --short; git log --oneline -12`

Expected: worktree is clean and the task commits are visible after the design commit.
