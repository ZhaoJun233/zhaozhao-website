import { z } from "astro/zod";
import aboutSource from "./about.json";
import creditsSource from "./credits.json";
import friendsSource from "./friends.json";
import guestbookSource from "./guestbook.json";
import homepageSource from "./homepage.json";
import navigationSource from "./navigation.json";
import nowSource from "./now.json";
import pageCopySource from "./page-copy.json";

const text = z.string().trim().min(1);
const internalHref = text.regex(/^\/(?!\/)/, "站内链接必须以单个 / 开头。");
const httpUrl = z.url({ protocol: /^https?$/ });
const action = z.object({ label: text, href: internalHref });

export const navigationSchema = z.object({
  items: z.array(action).min(1).max(12).superRefine((items, context) => {
    const hrefs = items.map(({ href }) => href);
    if (new Set(hrefs).size !== hrefs.length) {
      context.addIssue({ code: "custom", message: "导航链接不能重复。" });
    }
  }),
  mobile: z.object({ kicker: text, title: text, searchLabel: text, note: text }),
  footer: z.object({
    navigationLabel: text,
    linksLabel: text,
    rssLabel: text,
    creditsLabel: text,
    note: text,
  }),
});

export const homepageSchema = z.object({
  hero: z.object({
    eyebrow: text,
    typingLabel: text,
    typingPhrases: z.array(text).min(1).max(8),
    primaryActionLabel: text,
    secondaryActionLabel: text,
    scrollLabel: text,
  }),
  status: z.object({
    label: text,
    message: text,
    postsLabel: text,
    topicsLabel: text,
    latestLabel: text,
  }),
  featuredPosts: z.object({ eyebrow: text, title: text, linkLabel: text, emptyMessage: text }),
  topics: z.object({ eyebrow: text, title: text, navigationLabel: text }),
  featuredProjects: z.object({
    eyebrow: text,
    title: text,
    description: text,
    detailLabel: text,
    allLabel: text,
    statusLabels: z.object({ active: text, completed: text, archived: text }),
  }),
  introduction: z.object({
    eyebrow: text,
    title: text,
    body: text,
    primaryActionLabel: text,
    secondaryActionLabel: text,
    artworkCaption: text,
  }),
});

export const aboutSchema = z.object({
  seoDescription: text,
  hero: z.object({
    eyebrow: text,
    introduction: text,
    guestbookLabel: text,
    rssLabel: text,
  }),
  interests: z.object({
    eyebrow: text,
    title: text,
    description: text,
    items: z.array(z.object({ title: text, description: text })).min(1).max(12),
  }),
  workbench: z.object({
    eyebrow: text,
    title: text,
    description: text,
    tools: z.array(text).min(1).max(20),
  }),
  timeline: z.object({
    eyebrow: text,
    title: text,
    description: text,
    entries: z.array(z.object({
      date: text.regex(
        /^\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?$/,
        "时间必须使用 YYYY-MM 或 YYYY-MM-DD 格式。",
      ),
      title: text,
      description: text,
    })).max(30),
  }),
});

export const friendsSchema = z.object({
  seoDescription: text,
  hero: z.object({ eyebrow: text, title: text, description: text }),
  noticeTitle: text,
  notice: text,
  visitLabel: text,
  emptyTitle: text,
  emptyDescription: text,
  invitation: z.object({ eyebrow: text, title: text, description: text, actionLabel: text }),
  links: z.array(z.object({
    name: text,
    url: httpUrl,
    description: text,
    interests: z.array(text).min(1).max(8),
  })).max(100),
});

export const guestbookSchema = z.object({
  seoDescription: text,
  hero: z.object({ badge: text, eyebrow: text, title: text, description: text }),
  guidelines: z.object({
    eyebrow: text,
    title: text,
    items: z.array(text).min(1).max(12),
    setupLabel: text,
  }),
  discussion: z.object({ eyebrow: text, title: text, description: text }),
});

export const nowPageSchema = z.object({
  seoDescription: text,
  hero: z.object({
    eyebrow: text,
    title: text,
    weatherNotes: z.object({
      clear: text,
      cloudy: text,
      rain: text,
      snow: text,
      storm: text,
      fallback: text,
    }),
  }),
  music: z.object({
    eyebrow: text,
    title: text,
    emptyTitle: text,
    emptyDescription: text,
    openLabel: text,
  }),
});

export const creditsSchema = z.object({
  title: text,
  description: text,
  hero: z.object({ eyebrow: text, heading: text, introduction: text }),
  artwork: z.object({
    eyebrow: text,
    heading: text,
    introduction: text,
    sourceLinkLabel: text,
  }),
  libraries: z.object({
    eyebrow: text,
    heading: text,
    linkLabel: text,
    items: z.array(z.object({ name: text, role: text, license: text, url: httpUrl })).min(1).max(30),
  }),
});

const indexPage = z.object({
  title: text,
  description: text,
  eyebrow: text,
  heading: text,
  introduction: text.optional(),
  emptyTitle: text.optional(),
  emptyDescription: text.optional(),
  filteredEmptyTitle: text.optional(),
  filteredEmptyDescription: text.optional(),
});

export const pageCopySchema = z.object({
  posts: indexPage,
  archive: indexPage,
  categories: indexPage,
  tags: indexPage,
  projects: indexPage,
  search: indexPage,
  notFound: z.object({
    title: text,
    description: text,
    eyebrow: text,
    heading: text,
    introduction: text,
    homeLabel: text,
    searchLabel: text,
    recentEyebrow: text,
    recentTitle: text,
  }),
});

export const navigationContent = navigationSchema.parse(navigationSource);
export const homepageContent = homepageSchema.parse(homepageSource);
export const aboutContent = aboutSchema.parse(aboutSource);
export const friendsContent = friendsSchema.parse(friendsSource);
export const guestbookContent = guestbookSchema.parse(guestbookSource);
export const nowPageContent = nowPageSchema.parse(nowSource);
export const creditsContent = creditsSchema.parse(creditsSource);
export const pageCopy = pageCopySchema.parse(pageCopySource);
