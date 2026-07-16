import { basename, extname } from "node:path";
import matter from "gray-matter";
import { postInputSchema, type PostInput } from "./schemas";
import { AdminHttpError } from "./http";
import { taxonomySlug } from "../slug";

export const maxMarkdownImportBytes = 2 * 1024 * 1024;

function text(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  return String(value).trim() || undefined;
}

function boolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && ["true", "false"].includes(value.toLowerCase())) {
    return value.toLowerCase() === "true";
  }
  return fallback;
}

function tags(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，\n]/) : [];
  return items.map(text).filter((item): item is string => Boolean(item));
}

export function parseMarkdownPostImport(
  filename: string,
  source: string,
  now: Date = new Date(),
): PostInput {
  const extension = extname(filename).toLowerCase();
  if (![".md", ".markdown"].includes(extension)) {
    throw new AdminHttpError(415, "只支持 .md 或 .markdown 文件。" );
  }
  if (new TextEncoder().encode(source).byteLength > maxMarkdownImportBytes) {
    throw new AdminHttpError(413, "Markdown 文件不能超过 2 MiB。" );
  }

  const parsed = matter(source);
  const data = parsed.data as Record<string, unknown>;
  const rawSlug = text(data.slug) ?? basename(filename, extension);
  const normalizedSlug = taxonomySlug(rawSlug);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalizedSlug)) {
    throw new AdminHttpError(422, "文件名不能生成有效 Slug，请在 frontmatter 中填写英文 slug。" );
  }
  const categoryValue = Array.isArray(data.category) ? data.category[0] : data.category;

  return postInputSchema.parse({
    slug: normalizedSlug,
    title: text(data.title) ?? "",
    description: text(data.description) ?? text(data.summary) ?? "",
    body: parsed.content,
    publishedAt: data.publishedAt ?? data.date ?? data.pubDate ?? now,
    ...(data.updatedAt ?? data.updated ?? data.lastmod
      ? { updatedAt: data.updatedAt ?? data.updated ?? data.lastmod }
      : {}),
    draft: boolean(data.draft, true),
    category: text(categoryValue) ?? "",
    tags: tags(data.tags),
    ...(text(data.cover ?? data.image ?? data.heroImage)
      ? { cover: text(data.cover ?? data.image ?? data.heroImage) }
      : {}),
    ...(text(data.coverAlt ?? data.imageAlt ?? data.heroImageAlt)
      ? { coverAlt: text(data.coverAlt ?? data.imageAlt ?? data.heroImageAlt) }
      : {}),
    featured: boolean(data.featured, false),
    ...(text(data.series) ? { series: text(data.series) } : {}),
    ...(text(data.canonicalUrl ?? data.canonical)
      ? { canonicalUrl: text(data.canonicalUrl ?? data.canonical) }
      : {}),
  });
}
