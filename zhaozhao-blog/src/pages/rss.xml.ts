import rss from "@astrojs/rss";
import { siteConfig } from "../config/site";
import { sortPostEntries } from "../lib/content";
import { loadRuntimePosts, loadRuntimeProfile } from "../lib/runtime-content";

export async function GET({ site }: { site: URL | undefined }) {
  const posts = sortPostEntries(
    (await loadRuntimePosts()).filter(({ data }) => !data.draft),
  );
  const profile = await loadRuntimeProfile();

  return rss({
    title: `${profile.name} - ${profile.siteTitle}`,
    description: profile.description,
    site: site ?? new URL(siteConfig.siteUrl),
    stylesheet: "/rss-feed.xsl",
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
