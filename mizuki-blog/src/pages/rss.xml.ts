import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { siteConfig } from "../config/site";
import { sortPostEntries } from "../lib/content";

export async function GET({ site }: { site: URL | undefined }) {
  const posts = sortPostEntries(
    await getCollection("posts", ({ data }) => !data.draft),
  );

  return rss({
    title: siteConfig.title,
    description: siteConfig.description,
    site: site ?? new URL(siteConfig.siteUrl),
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.publishedAt,
      link: `/posts/${post.id}/`,
      categories: [post.data.category, ...post.data.tags],
      content: post.body,
    })),
    customData: `<language>${siteConfig.locale}</language>`,
  });
}
