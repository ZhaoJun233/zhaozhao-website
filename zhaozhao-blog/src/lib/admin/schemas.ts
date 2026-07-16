import { z } from "astro/zod";
import {
  aboutSchema,
  creditsSchema,
  guestbookSchema,
  homepageSchema,
  navigationSchema,
  pageCopySchema,
} from "../../data/content";

const text = z.string().trim().min(1);
const optionalText = z.string().trim().transform((value) => value || undefined).optional();
const httpUrl = z.url({ protocol: /^https?$/ });
const slug = text.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug 只能包含小写字母、数字和连字符。");
const dateText = z.union([z.string(), z.date()]).transform((value, context) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    context.addIssue({ code: "custom", message: "日期格式不正确。" });
    return z.NEVER;
  }
  return date.toISOString();
});

export const categoryInputSchema = z.object({
  name: text,
  description: optionalText,
  enabled: z.boolean().default(true),
});

export const friendInputSchema = z.object({
  name: text,
  url: httpUrl,
  description: text,
  interests: z.array(text).min(1).max(8),
  enabled: z.boolean().default(true),
});

export const postInputSchema = z.object({
  slug,
  title: text,
  description: text,
  body: z.string(),
  publishedAt: dateText,
  updatedAt: dateText.optional(),
  draft: z.boolean().default(false),
  category: text,
  tags: z.array(text).min(1).max(8),
  cover: optionalText,
  coverAlt: optionalText,
  featured: z.boolean().default(false),
  series: optionalText,
  canonicalUrl: httpUrl.optional(),
}).superRefine((post, context) => {
  if (Boolean(post.cover) !== Boolean(post.coverAlt)) {
    context.addIssue({ code: "custom", path: ["coverAlt"], message: "封面与说明必须同时填写。" });
  }
});

export const projectInputSchema = z.object({
  slug,
  title: text,
  description: text,
  body: z.string(),
  date: dateText,
  status: z.enum(["active", "completed", "archived"]),
  tags: z.array(text).min(1).max(6),
  cover: optionalText,
  repositoryUrl: httpUrl.optional(),
  demoUrl: httpUrl.optional(),
  featured: z.boolean().default(false),
});

export const profileSettingSchema = z.object({
  name: text,
  siteTitle: text,
  description: text,
  bio: text,
  avatar: text,
});

export const artworkSettingSchema = z.object({
  homeHero: z.object({ image: text, title: text, alt: text }),
  aboutSummerDream: z.object({
    image: text,
    title: text,
    alt: text,
    sourceUrl: httpUrl,
    uploader: text,
    bvid: text,
  }),
});

export const friendPageSettingSchema = z.object({
  seoDescription: text,
  hero: z.object({ eyebrow: text, title: text, description: text }),
  noticeTitle: text,
  notice: text,
  visitLabel: text,
  emptyTitle: text,
  emptyDescription: text,
  invitation: z.object({ eyebrow: text, title: text, description: text, actionLabel: text }),
});

export const settingSchemas = {
  profile: profileSettingSchema,
  navigation: navigationSchema,
  homepage: homepageSchema,
  about: aboutSchema,
  guestbook: guestbookSchema,
  credits: creditsSchema,
  page_copy: pageCopySchema,
  artwork: artworkSettingSchema,
  friend_page: friendPageSettingSchema,
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type FriendInput = z.infer<typeof friendInputSchema>;
export type PostInput = z.input<typeof postInputSchema>;
export type ProjectInput = z.input<typeof projectInputSchema>;
