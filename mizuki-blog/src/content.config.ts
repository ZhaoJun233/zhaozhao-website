import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const requiredText = z.string().trim().min(1);
const normalizedText = z
  .string()
  .transform((value) => value.normalize("NFKC").trim())
  .pipe(z.string().min(1));

function normalizedUniqueTags(maximum: number) {
  return z
    .array(normalizedText)
    .transform((tags) => [...new Set(tags)])
    .pipe(z.array(z.string()).min(1).max(maximum));
}

const posts = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/posts" }),
  schema: ({ image }) =>
    z
      .object({
        title: requiredText,
        description: requiredText,
        publishedAt: z.coerce.date(),
        updatedAt: z.coerce.date().optional(),
        draft: z.boolean().default(false),
        tags: normalizedUniqueTags(8),
        category: normalizedText,
        cover: image().optional(),
        coverAlt: normalizedText.optional(),
        featured: z.boolean().default(false),
        series: normalizedText.optional(),
        canonicalUrl: z.url().optional(),
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
      }),
});

const projects = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/projects" }),
  schema: ({ image }) =>
    z.object({
      title: requiredText,
      description: requiredText,
      date: z.coerce.date(),
      status: z.enum(["active", "completed", "archived"]),
      tags: normalizedUniqueTags(6),
      cover: image().optional(),
      repositoryUrl: z.url().optional(),
      demoUrl: z.url().optional(),
      featured: z.boolean().default(false),
    }),
});

export const collections = { posts, projects };
