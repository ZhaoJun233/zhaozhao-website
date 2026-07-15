import { siteConfig } from "../config/site";

export type JsonLdPrimitive = string | number | boolean | null;
export type JsonLdValue =
  | JsonLdPrimitive
  | JsonLdNode
  | JsonLdValue[];
export type JsonLdNode = { [key: string]: JsonLdValue | undefined };

export type SeoImage = string | URL | { src: string };

export interface BlogPostingSeoInput {
  title: string;
  description: string;
  path: string | URL;
  publishedAt: Date | string;
  updatedAt?: Date | string;
  canonicalUrl?: string | URL;
  image?: SeoImage;
  tags?: string[];
  category?: string;
  authorName?: string;
}

export interface PersonJsonLd extends JsonLdNode {
  "@type": "Person";
  "@id": string;
  name: string;
  description: string;
  url: string;
}

export interface WebsiteJsonLd extends JsonLdNode {
  "@context": "https://schema.org";
  "@type": "WebSite";
  "@id": string;
  url: string;
  name: string;
  description: string;
  inLanguage: "zh-CN";
  publisher: PersonJsonLd;
}

export interface BlogPostingJsonLd extends JsonLdNode {
  "@context": "https://schema.org";
  "@type": "BlogPosting";
  headline: string;
  description: string;
  inLanguage: "zh-CN";
  datePublished: string;
  dateModified: string;
  url: string;
  mainEntityOfPage: { "@type": "WebPage"; "@id": string };
  author: { "@type": "Person"; "@id": string; name: string };
  publisher: { "@type": "Person"; "@id": string; name: string };
}

const pageFilePattern = /\/[^/]+\.[a-z0-9]+$/i;

function siteRoot(): string {
  return siteConfig.siteUrl.endsWith("/")
    ? siteConfig.siteUrl
    : `${siteConfig.siteUrl}/`;
}

function withTrailingSlash(url: URL): URL {
  if (url.pathname !== "/" && !url.pathname.endsWith("/") && !pageFilePattern.test(url.pathname)) {
    url.pathname = `${url.pathname}/`;
  }

  return url;
}

function imageSource(image: SeoImage): string {
  if (image instanceof URL) return image.href;
  return typeof image === "string" ? image : image.src;
}

function buildAssetUrl(image: SeoImage): string {
  return new URL(imageSource(image), siteRoot()).href;
}

function isoDate(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function buildPersonJsonLd(): PersonJsonLd {
  return {
    "@type": "Person",
    "@id": `${buildCanonical("/")}#person`,
    name: siteConfig.author.name,
    description: siteConfig.author.bio,
    url: buildCanonical("/"),
  };
}

export function buildCanonical(path: string | URL): string {
  const url = path instanceof URL ? new URL(path.href) : new URL(path, siteRoot());
  return withTrailingSlash(url).href;
}

export function buildWebsiteJsonLd(): WebsiteJsonLd {
  const root = buildCanonical("/");

  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${root}#website`,
    url: root,
    name: siteConfig.name,
    description: siteConfig.description,
    inLanguage: siteConfig.locale,
    publisher: buildPersonJsonLd(),
  };
}

export function buildBlogPostingJsonLd(
  post: BlogPostingSeoInput,
): BlogPostingJsonLd {
  const canonical = buildCanonical(post.canonicalUrl ?? post.path);
  const authorName = post.authorName ?? siteConfig.author.name;
  const publishedAt = isoDate(post.publishedAt);
  const updatedAt = isoDate(post.updatedAt ?? post.publishedAt);

  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.description,
    inLanguage: siteConfig.locale,
    datePublished: publishedAt,
    dateModified: updatedAt,
    url: canonical,
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": canonical,
    },
    author: {
      "@type": "Person",
      "@id": `${buildCanonical("/")}#person`,
      name: authorName,
    },
    publisher: {
      "@type": "Person",
      "@id": `${buildCanonical("/")}#person`,
      name: siteConfig.author.name,
    },
    ...(post.image ? { image: [buildAssetUrl(post.image)] } : {}),
    ...(post.category ? { articleSection: post.category } : {}),
    ...(post.tags?.length ? { keywords: post.tags.join(", ") } : {}),
  };
}
