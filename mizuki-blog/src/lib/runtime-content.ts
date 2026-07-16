import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import matter from "gray-matter";
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
import { taxonomySlug } from "./slug";

const requiredText = z.string().trim().min(1);
const optionalText = z.string().trim().min(1).optional();
const httpUrl = z.url({ protocol: /^https?$/ });
const contentRoot = resolve(process.env.CONTENT_ROOT ?? join(process.cwd(), "src"));
const dataRoot = join(contentRoot, "data");
const postRoot = join(contentRoot, "content", "posts");
const projectRoot = join(contentRoot, "content", "projects");

const profileSchema = z.object({
  name: requiredText,
  siteTitle: requiredText,
  description: requiredText,
  bio: requiredText,
  avatar: requiredText,
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

async function readJson<T>(filename: string, schema: z.ZodType<T>): Promise<T> {
  const raw = JSON.parse(await readFile(join(dataRoot, filename), "utf8"));
  return schema.parse(raw);
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

async function readMarkdownDirectory<T>(
  directory: string,
  schema: z.ZodType<T>,
): Promise<Array<{ id: string; body: string; html: string; headings: MarkdownHeading[]; data: T }>> {
  const filenames = (await readdir(directory)).filter((file) => extname(file).toLowerCase() === ".md");
  return Promise.all(filenames.map(async (filename) => {
    const parsed = matter(await readFile(join(directory, filename), "utf8"));
    const data = schema.parse(parsed.data);
    const { marked, headings } = createMarkdownRenderer();
    return {
      id: basename(filename, extname(filename)),
      body: parsed.content,
      html: await marked.parse(parsed.content),
      headings,
      data,
    };
  }));
}

export async function loadRuntimeProfile(): Promise<RuntimeProfile> {
  const profile = await readJson("profile.json", profileSchema);
  return { ...profile, avatarUrl: mediaUrl(profile.avatar)! };
}

export async function loadRuntimeEditorial() {
  const [navigation, homepage, about, friends, guestbook, credits, pageCopy, taxonomy, artwork] =
    await Promise.all([
      readJson("navigation.json", navigationSchema),
      readJson("homepage.json", homepageSchema),
      readJson("about.json", aboutSchema),
      readJson("friends.json", friendsSchema),
      readJson("guestbook.json", guestbookSchema),
      readJson("credits.json", creditsSchema),
      readJson("page-copy.json", pageCopySchema),
      readJson("taxonomy.json", taxonomySchema),
      readJson("artwork.json", artworkSchema),
    ]);
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
  const posts = await readMarkdownDirectory(postRoot, postDataSchema);
  return posts.map((post) => ({
    ...post,
    data: { ...post.data, coverUrl: mediaUrl(post.data.cover) },
  }));
}

export async function loadRuntimeProjects(): Promise<RuntimeProject[]> {
  const projects = await readMarkdownDirectory(projectRoot, projectDataSchema);
  return projects.map((project) => ({
    ...project,
    data: { ...project.data, coverUrl: mediaUrl(project.data.cover) },
  }));
}

export function runtimeContentRoot(): string {
  return contentRoot;
}
