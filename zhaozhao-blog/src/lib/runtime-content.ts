import { basename, join, resolve } from "node:path";
import { Marked, type Token } from "marked";
import { z } from "astro/zod";
import type { MarkdownHeading } from "astro";
import {
  aboutSchema,
  creditsSchema,
  friendsSchema,
  guestbookSchema,
  homepageSchema,
  navigationSchema,
  pageCopySchema,
} from "../data/content";
import {
  readCategories,
  readFriendPage,
  readFriends,
  readPosts,
  readProjects,
  readSetting,
} from "./database/content-repository";
import { taxonomySlug } from "./slug";

const requiredText = z.string().trim().min(1);
const optionalText = z.string().trim().min(1).optional();
const httpUrl = z.url({ protocol: /^https?$/ });
const contentRoot = resolve(process.env.CONTENT_ROOT ?? join(process.cwd(), "src"));

const profileSchema = z.object({
  name: requiredText,
  siteTitle: requiredText,
  description: requiredText,
  bio: requiredText,
  avatar: requiredText,
  occupation: z.string(),
  location: z.string(),
  motto: z.string(),
  email: z.string(),
  website: z.string(),
});
const taxonomySchema = z.object({
  categories: z.array(z.object({ name: requiredText, description: optionalText })).min(1),
});
const artworkSchema = z.object({
  homeHero: z.object({ image: requiredText, title: requiredText, alt: requiredText }),
  aboutSummerDream: z.object({
    image: requiredText,
    title: requiredText,
    alt: requiredText,
    sourceUrl: httpUrl,
    uploader: requiredText,
    bvid: requiredText,
  }),
});
const date = z.union([z.date(), requiredText.pipe(z.coerce.date())]);
const postDataSchema = z.object({
  title: requiredText,
  description: requiredText,
  publishedAt: date,
  updatedAt: date.optional(),
  draft: z.boolean().default(false),
  tags: z.array(requiredText).min(1).max(8),
  category: requiredText,
  cover: optionalText,
  coverAlt: optionalText,
  featured: z.boolean().default(false),
  series: optionalText,
  canonicalUrl: httpUrl.optional(),
}).superRefine((post, context) => {
  if ((post.cover === undefined) !== (post.coverAlt === undefined)) {
    context.addIssue({ code: "custom", path: ["coverAlt"], message: "封面与说明必须同时填写。" });
  }
});
const projectDataSchema = z.object({
  title: requiredText,
  description: requiredText,
  date,
  status: z.enum(["active", "completed", "archived"]),
  tags: z.array(requiredText).min(1).max(6),
  cover: optionalText,
  repositoryUrl: httpUrl.optional(),
  demoUrl: httpUrl.optional(),
  featured: z.boolean().default(false),
});

export type RuntimeProfile = z.infer<typeof profileSchema> & { avatarUrl: string };
export type RuntimePost = {
  id: string;
  body: string;
  html: string;
  headings: MarkdownHeading[];
  data: z.infer<typeof postDataSchema> & { coverUrl?: string };
};
export type RuntimeProject = {
  id: string;
  body: string;
  html: string;
  data: z.infer<typeof projectDataSchema> & { coverUrl?: string };
};

function mediaUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replaceAll("\\", "/");
  const marker = "/assets/";
  const index = normalized.lastIndexOf(marker);
  if (index >= 0) return `/media/${normalized.slice(index + marker.length)}/`;
  return `/media/uploads/${basename(normalized)}/`;
}

function createMarkdownRenderer() {
  const headings: MarkdownHeading[] = [];
  const used = new Map<string, number>();
  const marked = new Marked();
  marked.use({
    renderer: {
      heading({ tokens, depth }: Token & { tokens: Token[]; depth: number }) {
        const text = this.parser.parseInline(tokens);
        const plainText = text.replace(/<[^>]+>/g, "").trim();
        const base = taxonomySlug(plainText) || "section";
        const count = used.get(base) ?? 0;
        used.set(base, count + 1);
        const slug = count === 0 ? base : `${base}-${count + 1}`;
        headings.push({ depth, slug, text: plainText });
        return `<h${depth} id="${slug}">${text}</h${depth}>`;
      },
    },
  });
  return { marked, headings };
}

async function renderMarkdown(body: string) {
  const { marked, headings } = createMarkdownRenderer();
  return { html: await marked.parse(body), headings };
}

export async function loadRuntimeProfile(): Promise<RuntimeProfile> {
  const profile = profileSchema.parse(readSetting("profile"));
  return { ...profile, avatarUrl: mediaUrl(profile.avatar)! };
}

export async function loadRuntimeEditorial() {
  const navigation = navigationSchema.parse(readSetting("navigation"));
  const homepage = homepageSchema.parse(readSetting("homepage"));
  const about = aboutSchema.parse(readSetting("about"));
  const guestbook = guestbookSchema.parse(readSetting("guestbook"));
  const credits = creditsSchema.parse(readSetting("credits"));
  const pageCopy = pageCopySchema.parse(readSetting("page_copy"));
  const taxonomy = taxonomySchema.parse({
    categories: readCategories().map(({ name, description }) => ({
      name,
      ...(description ? { description } : {}),
    })),
  });
  const friends = friendsSchema.parse({
    ...readFriendPage<Record<string, unknown>>(),
    links: readFriends().map((friend) => ({
      name: friend.name,
      url: friend.url,
      description: friend.description,
      interests: JSON.parse(friend.interests_json),
    })),
  });
  const artwork = artworkSchema.parse(readSetting("artwork"));
  return {
    navigation,
    homepage,
    about,
    friends,
    guestbook,
    credits,
    pageCopy,
    taxonomy,
    artwork: {
      homeHero: { ...artwork.homeHero, imageUrl: mediaUrl(artwork.homeHero.image)! },
      aboutSummerDream: {
        ...artwork.aboutSummerDream,
        imageUrl: mediaUrl(artwork.aboutSummerDream.image)!,
      },
    },
  };
}

export async function loadRuntimePosts(): Promise<RuntimePost[]> {
  return Promise.all(readPosts().map(async (row) => {
    const body = row.body;
    const rendered = await renderMarkdown(body);
    const data = postDataSchema.parse({
      title: row.title,
      description: row.description,
      publishedAt: new Date(row.published_at),
      ...(row.updated_at ? { updatedAt: new Date(row.updated_at) } : {}),
      draft: Boolean(row.draft),
      category: row.category,
      tags: JSON.parse(row.tags_json),
      ...(row.cover ? { cover: row.cover } : {}),
      ...(row.cover_alt ? { coverAlt: row.cover_alt } : {}),
      featured: Boolean(row.featured),
      ...(row.series ? { series: row.series } : {}),
      ...(row.canonical_url ? { canonicalUrl: row.canonical_url } : {}),
    });
    return {
      id: row.slug,
      body,
      ...rendered,
      data: { ...data, coverUrl: mediaUrl(data.cover) },
    };
  }));
}

export async function loadRuntimeProjects(): Promise<RuntimeProject[]> {
  return Promise.all(readProjects().map(async (row) => {
    const body = row.body;
    const rendered = await renderMarkdown(body);
    const data = projectDataSchema.parse({
      title: row.title,
      description: row.description,
      date: new Date(row.project_date),
      status: row.status,
      tags: JSON.parse(row.tags_json),
      ...(row.cover ? { cover: row.cover } : {}),
      ...(row.repository_url ? { repositoryUrl: row.repository_url } : {}),
      ...(row.demo_url ? { demoUrl: row.demo_url } : {}),
      featured: Boolean(row.featured),
    });
    return {
      id: row.slug,
      body,
      ...rendered,
      data: { ...data, coverUrl: mediaUrl(data.cover) },
    };
  }));
}

export function runtimeContentRoot(): string {
  return contentRoot;
}
