import { z } from "astro/zod";
import {
  aboutSchema,
  creditsSchema,
  guestbookSchema,
  homepageSchema,
  navigationSchema,
  nowPageSchema,
  pageCopySchema,
} from "../../data/content";

const text = z.string().trim().min(1);
const optionalText = z.string().trim().transform((value) => value || undefined).optional();
const httpUrl = z.string().trim().refine((value) => {
  try {
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
}, "链接必须以 http:// 或 https:// 开头，并填写完整地址。");
const uuid = z.string().trim().regex(
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  "草稿标识失效，请刷新文章管理页面后重试。",
);
const blankText = z.string().trim().max(160);
const blankEmail = z.union([z.literal(""), z.email()]);
const blankHttpUrl = z.union([z.literal(""), httpUrl]);
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

export const musicTrackInputSchema = z.object({
  title: text,
  artist: text,
  neteaseSongId: text.regex(/^\d{1,20}$/, "网易云歌曲 ID 只能填写数字。"),
  audioUrl: httpUrl.optional(),
  note: optionalText,
  enabled: z.boolean().default(true),
  draftToken: uuid.optional(),
  coverAssetId: z.uuid().optional(),
});

export const musicMetadataInputSchema = z.object({
  neteaseSongId: text.regex(/^\d{1,20}$/, "网易云歌曲 ID 只能填写数字。"),
  draftToken: uuid,
});

export const postMediaInputSchema = z.object({
  draftToken: uuid.optional(),
  coverAssetId: uuid.optional(),
  retainedAssetIds: z.array(uuid).max(100).default([]),
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
  occupation: blankText,
  location: blankText,
  motto: blankText,
  email: blankEmail,
  website: blankHttpUrl,
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
  now_page: nowPageSchema,
  credits: creditsSchema,
  page_copy: pageCopySchema,
  artwork: artworkSettingSchema,
  friend_page: friendPageSettingSchema,
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type FriendInput = z.infer<typeof friendInputSchema>;
export type MusicTrackInput = z.infer<typeof musicTrackInputSchema>;
export type MusicMetadataInput = z.infer<typeof musicMetadataInputSchema>;
export type PostInput = z.input<typeof postInputSchema>;
export type PostMediaInput = z.infer<typeof postMediaInputSchema>;
export type ProjectInput = z.input<typeof projectInputSchema>;
