# Mizuki Anime Personal Blog Design

## Goal

Build a complete Astro personal blog with a polished light anime aesthetic, fast reading experience, strong content discovery, and maintainable Markdown authoring. The site must work as a static deployment without a custom server.

## Product Direction

The site is a personal journal for anime, development notes, projects, and daily fragments. It should feel like a quiet Japanese editorial site rather than a generic template or a dense dashboard.

The default site identity is `Mizuki.` and all identity fields live in one editable configuration file. Sample content demonstrates the finished experience but is clearly replaceable.

## Visual System

### Home Hero

- Use the user-provided `D:/Users/zhao/Desktop/AIGC/修图.png` as the home hero.
- Preserve the complete composition with a foreground `<img>` using `object-fit: contain`. A blurred and washed duplicate may fill unused hero space, but it must never replace or crop the foreground image.
- At widths of 900px and above, the hero is between 620px and 800px tall and never exceeds 82svh. Text overlays the natural left-side negative space.
- Below 900px, the image is a separate 16:9 band and all title, description, typing status, and actions move into an unframed block below it. Mobile text never overlays the character.
- The source image bounds must be visible at 1440x900 and 1920x1080. At 320x568, 390x844, and 768x1024, the character's full head and upper body must remain visible.
- Keep a visible hint of the next section in the first viewport.
- Add restrained CSS motion: drifting petals, typing text, scroll indicator, subtle interface hover states, and a low-amplitude color-breath effect. Do not zoom the hero image.
- Respect `prefers-reduced-motion` and stop decorative motion when requested.

### Secondary Artwork

- Use the selected Bilibili cover `【动态壁纸】夏日白色绮梦` on the About page hero and the home personal-introduction band.
- Source page: `https://www.bilibili.com/video/BV1NCjx6oEhj/`; cover URL: `https://i1.hdslb.com/bfs/archive/c439b38012563ee914ecb97bcad4155773c3ccf0.jpg`; uploader: `清水未萌_Minamo` (`mid 502016263`).
- Store the 2558x1439 cover at `src/assets/backgrounds/about-summer-dream.jpg`. The expected SHA-256 is `A70CDC0597270E2A0336C5D7E9A556B0CBF53F49F69A26235475B21C46CAA094`.
- Asset metadata uses the alt text `粉紫色海边的白发少女插画` and exposes the source page, uploader, BV id, and placement list on the Credits page.
- Other searched Bilibili images are design references only and are not bundled in the production site.

### Typography And Color

- Use system CJK sans-serif for body copy and a restrained serif face for editorial display text.
- Use neutral white/charcoal foundations with sea-cyan and sakura-pink accents. Avoid a one-color pink or blue interface.
- Cards use a maximum 8px radius. Sections are unframed full-width bands; cards are reserved for repeated posts and projects.
- Body copy targets 68-74 characters per line, comfortable line height, and accessible contrast in light and dark themes.

## Information Architecture

### Global Navigation

- Home
- Articles
- Categories and tags
- Archive
- Projects
- Friends
- About
- Guestbook
- Search

The desktop header is translucent over the hero and becomes solid after scrolling. Mobile uses a keyboard-accessible navigation drawer. Search and theme controls use Lucide icons with tooltips and accessible labels.

### Route Contract

- `/`: home
- `/posts/` and `/posts/page/{n}/`: article index, eight posts per page
- `/posts/{slug}/`: article detail
- `/categories/` and `/categories/{slug}/`: category index and category results
- `/tags/` and `/tags/{slug}/`: tag index and tag results
- `/archive/`: archive
- `/projects/` and `/projects/{slug}/`: project index and detail
- `/friends/`, `/about/`, `/guestbook/`, `/search/`, and `/credits/`: static feature pages
- `/rss.xml`, `/sitemap-index.xml`, `/robots.txt`, and `/404.html`: generated system routes

Routes use `trailingSlash: "always"`. Content slugs come from collection file paths. Taxonomy slugs use NFKC normalization, lowercase ASCII, retain Chinese characters, replace whitespace/punctuation runs with `-`, trim `-`, and fail the build on collisions.

### Pages

1. **Home**: hero, site status, featured article, recent articles, topic shortcuts, featured projects, personal introduction, and footer.
2. **Articles**: paginated article list with compact cards and links into category/tag result pages.
3. **Article detail**: cover, metadata, reading time, table of contents, reading progress, syntax highlighting, code copy buttons, previous/next navigation, share/copy-link action, related posts, and lazy-loaded comments.
4. **Categories and tags**: taxonomy indexes and individual result pages.
5. **Archive**: posts grouped by year and month with counts.
6. **Projects**: filterable project index and project detail pages; status filters are inclusive and only one status is active at a time.
7. **Friends**: curated friend links with validated metadata and empty state.
8. **About**: selected Bilibili visual, profile, timeline, interests, tools, and contact links.
9. **Guestbook**: introduction and a Giscus discussion mapped to a fixed page.
10. **Search**: Pagefind-backed dialog and standalone results page. Search filters use one exact category and OR semantics across selected tags.
11. **404**: branded recovery page with search and home navigation.
12. **Credits**: artwork source, uploader/source URL, libraries, licenses, and Giscus setup guidance.

## Content Model

### Posts

Astro Content Collections validate:

- `title`
- `description`
- `publishedAt`
- optional `updatedAt`
- `draft`
- `tags`
- `category`
- optional optimized `cover` and required `coverAlt`
- optional `featured`
- optional `series`
- optional canonical URL

The file path is the stable slug. Tags, categories, archives, related content, and pagination are derived from posts rather than duplicated in separate data files.

Posts require one category and 1-8 unique tags. `coverAlt` is required exactly when `cover` is present. `draft` defaults to `false`, tags are de-duplicated after NFKC normalization, and future-dated posts remain visible unless explicitly marked draft.

Article ordering is `publishedAt` descending, then slug ascending. Home shows up to three explicitly featured posts and fills missing positions with the newest non-draft posts. Reading time is `ceil(CJK characters / 400 + Latin words / 200)` with a minimum of one minute. Related-post score is three points for the same category, two per shared tag, and one for the same series; ties use publication date then slug, and the top three are shown.

### Projects

Projects validate title, description, date, status (`active`, `completed`, or `archived`), tags, cover, repository URL, demo URL, and featured state.

Project title, description, date, status, and 1-6 unique tags are required. Cover, repository URL, demo URL, and featured state are optional; `featured` defaults to `false`. Projects sort by featured state, date descending, then slug.

### Site Data

Typed data files hold identity, social links, navigation, friends, timeline, and artwork metadata. Invalid external URLs or missing required alternative text fail the build.

The checked-in demonstration data contains six posts, three projects, four friend links, and four timeline entries. It uses neutral fictional personal details. Empty optional social/contact fields are hidden rather than rendered as dead controls.

## Technical Architecture

- Astro static site generation with strict TypeScript.
- Astro Content Collections for posts and projects.
- Markdown by default; MDX is excluded until interactive article content is required.
- Native CSS variables and scoped component styles; no Tailwind and no client UI framework.
- `lucide-astro` for interface icons.
- `Pagefind` indexes built HTML after `astro build`.
- `@astrojs/rss` and `@astrojs/sitemap` provide feeds and sitemap generation.
- Giscus provides article comments and guestbook discussions. Missing Giscus environment configuration renders a clear local setup state without breaking the page.
Client JavaScript is limited to navigation, theme, search, code-copy actions, reading progress, filters, and lazy comment loading.

### Module Boundaries

- `src/config/site.ts`: locale, timezone, identity, navigation, pagination size, deployment URL, and feature configuration.
- `src/content.config.ts`: Zod schemas only; it does not query or format content.
- `src/lib/content.ts`: collection queries, sorting, draft filtering, taxonomy aggregation, pagination, reading time, and related scoring.
- `src/lib/seo.ts`: canonical URLs, Open Graph values, JSON-LD, RSS values, and breadcrumbs.
- `src/layouts`: document shell and article shell; layouts receive prepared data and do not query collections.
- `src/components`: presentational server-rendered components grouped into layout, blog, project, and UI directories.
- `src/scripts`: independent client controllers for navigation, theme, search dialog, code copy, reading progress, filters, and lazy comments.
- `src/components/integrations`: Pagefind and Giscus adapters with explicit configured and unconfigured states.

Build data flows from Markdown through collection schema validation, `content.ts` queries, static route generation, layout rendering, and finally Pagefind indexing of `dist`. RSS and sitemap consume the same filtered content queries, so drafts cannot leak through a separate code path.

## Search And Discovery

- Pagefind indexes article bodies, titles, summaries, tags, categories, and project descriptions.
- Search opens from the header, `/` keyboard shortcut, or standalone page.
- The dialog traps focus, closes with Escape, restores focus, supports arrow-key result navigation, and gives useful empty/no-result states.
- Search remains excluded from the initial page payload until opened.

## Theme And Preferences

- Light, dark, and system modes are available through an icon-based segmented menu.
- A small inline head script applies the saved theme before paint to avoid flashing.
- Theme preference persists in local storage. Decorative motion follows `prefers-reduced-motion`; there is no separate persisted motion setting.
- Both themes keep artwork readable through separate overlay tokens rather than simple color inversion.

## SEO And Feeds

- Per-page canonical URL, description, Open Graph data, and social card fallback.
- `WebSite`, `Person`, `BlogPosting`, and breadcrumb JSON-LD where appropriate.
- RSS feed, sitemap, `robots.txt`, favicon set, and web manifest.
- Drafts are excluded from production lists, feeds, search, sitemap, and generated routes.

The site language is `zh-CN`, timezone is `Asia/Shanghai`, and dates render with `Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai" })`. Pagefind pages declare `lang="zh-CN"` and index Chinese text as rendered.

`PUBLIC_SITE_URL` is required for production and defaults to `http://localhost:4321` in local commands. The initial deployment contract uses the domain root (`base: "/"`) and static output without an adapter. Canonical URLs always derive from `Astro.site`, never from request headers.

`npm run build` runs `astro build` followed by `pagefind --site dist`. Full search acceptance uses `npm run build && npm run preview`; `astro dev` shows a designed notice that its search index is generated by the production build.

## Giscus Contract

Giscus reads `PUBLIC_GISCUS_REPO`, `PUBLIC_GISCUS_REPO_ID`, `PUBLIC_GISCUS_CATEGORY`, and `PUBLIC_GISCUS_CATEGORY_ID`. Article discussions map by pathname. Guestbook uses the fixed term `guestbook`. An IntersectionObserver loads Giscus when the placeholder is within 600px of the viewport.

When any required value is missing, the page renders `评论功能尚未配置` plus a link to the Credits/Setup section and does not request the Giscus script. Tests cover both configured markup and this missing-configuration state.

## Performance And Accessibility

- The home hero is preloaded and optimized; below-fold media is lazy-loaded.
- Images have stable aspect ratios and explicit dimensions to prevent layout shift.
- Decorative effects use CSS and one shared IntersectionObserver, not a particle library.
- All controls are keyboard accessible with visible focus states.
- Dialogs manage focus correctly, landmarks and headings are semantic, and every meaningful image has useful alternative text.
- The site remains readable without client JavaScript; only enhanced interactions degrade.
- Performance targets use Lighthouse mobile simulated throttling (Slow 4G, 4x CPU slowdown), three runs, with median LCP below 2.5 seconds and CLS below 0.1.

## Error And Empty States

- Missing or invalid content metadata fails during `astro check` or build.
- Lists, tag filters, search, friends, projects, and comments have designed empty/configuration states.
- Broken artwork metadata does not silently fall back to a cropped image.
- External links use safe attributes and show a consistent external-link indicator.
- The 404 page provides search, recent articles, and a direct home action.

## Testing

- `astro check` validates templates, TypeScript, and collection schemas.
- Vitest covers post sorting, draft filtering, tag/category slug generation, archive grouping, reading-time calculation, related-post selection, and SEO/RSS helpers.
- Playwright covers home navigation, article reading, filters, search, theme persistence, code copy, comments configuration state, and 404 recovery.
- Playwright viewports: 320x568, 390x844, 768x1024, 1440x900, and 1920x1080. A 2560x1440 screenshot is also captured for the hero and article layout.
- Axe checks keyboard focus, heading order, image alternatives, labels, and contrast, with zero serious or critical violations. The design targets WCAG 2.2 AA.
- Screenshot checks explicitly verify that the home character's head is visible, navigation does not overlap content, long titles fit, and both themes remain coherent.
- Production verification checks Pagefind results, RSS XML, sitemap, internal links, and the no-JavaScript reading path.

## Project Boundary

Create the project in `E:/ShortTime/shortTimeSpace/mizuki-blog`. The Git repository root is `E:/ShortTime/shortTimeSpace`; do not modify the unrelated `reverse` directory.

## Acceptance Criteria

The implementation is complete when:

1. Every route in the route contract builds. Navigation, pagination, category/tag browsing, project detail, friend links, guestbook state, search, credits, and 404 recovery each pass a Playwright workflow.
2. The home hero uses the user image without cutting off the character's head.
3. The selected Bilibili image appears only in the About hero and home introduction band, with the exact asset metadata listed above.
4. Posts and projects are driven by validated content collections containing the specified six sample posts and three sample projects.
5. Pagefind returns title/body/tag results after the production build; archive grouping, theme persistence, article enhancements, RSS, sitemap, canonical/JSON-LD metadata, Giscus states, and designed empty states pass targeted tests.
6. `astro check`, unit tests, production build, and Playwright tests pass.
7. Browser screenshots and accessibility checks show no overlap, clipping, blank media, unusable control, or incoherent mobile layout.
8. A production build preview server is running and its URL is provided for review so Pagefind behavior is included.
