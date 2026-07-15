import { defineCollection, type SchemaContext } from "astro/content/config";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const requiredText = z.string().trim().min(1);
const normalizedText = z
  .string()
  .transform((value) => value.normalize("NFKC").trim())
  .pipe(z.string().min(1));
const contentDate = z.union([
  z.date(),
  z.string().trim().min(1).pipe(z.coerce.date()),
]);
const httpUrl = z.url({ protocol: /^https?$/ });

function normalizedUniqueTags(maximum: number) {
  return z
    .array(normalizedText)
    .transform((tags) => [...new Set(tags)])
    .pipe(z.array(z.string()).min(1).max(maximum));
}

export const createPostSchema = ({ image }: SchemaContext) =>
  z
    .object({
      title: requiredText,
      description: requiredText,
      publishedAt: contentDate,
      updatedAt: contentDate.optional(),
      draft: z.boolean().default(false),
      tags: normalizedUniqueTags(8),
      category: normalizedText,
      cover: image().optional(),
      coverAlt: normalizedText.optional(),
      featured: z.boolean().default(false),
      series: normalizedText.optional(),
      canonicalUrl: httpUrl.optional(),
    })
    .superRefine((post, context) => {
      if (post.cover !== undefined && post.coverAlt === undefined) {
        context.addIssue({
          code: "custom",
          path: ["coverAlt"],
          message: "coverAlt is required when cover is present.",
        });
      }

      if (post.cover === undefined && post.coverAlt !== undefined) {
        context.addIssue({
          code: "custom",
          path: ["coverAlt"],
          message: "coverAlt requires a cover image.",
        });
      }
    });

export const createProjectSchema = ({ image }: SchemaContext) =>
  z.object({
    title: requiredText,
    description: requiredText,
    date: contentDate,
    status: z.enum(["active", "completed", "archived"]),
    tags: normalizedUniqueTags(6),
    cover: image().optional(),
    repositoryUrl: httpUrl.optional(),
    demoUrl: httpUrl.optional(),
    featured: z.boolean().default(false),
  });

const posts = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/posts" }),
  schema: createPostSchema,
});

const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: createProjectSchema,
});

export const collections = { posts, projects };
