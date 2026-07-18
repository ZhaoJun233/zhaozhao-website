import profile from "../data/profile.json";
import { navigationContent } from "../data/content";

export type NavigationItem = { label: string; href: string };
export type SiteConfig = {
  name: string;
  title: string;
  description: string;
  locale: "zh-CN";
  timeZone: "Asia/Shanghai";
  siteUrl: string;
  pageSize: 8;
  author: { name: string; bio: string; avatar: string; email?: string };
  navigation: NavigationItem[];
  giscus: { repo?: string; repoId?: string; category?: string; categoryId?: string };
};

export const siteConfig: SiteConfig = {
  name: profile.name,
  title: `${profile.name} - ${profile.siteTitle}`,
  description: profile.description,
  locale: "zh-CN",
  timeZone: "Asia/Shanghai",
  siteUrl: import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321",
  pageSize: 8,
  author: {
    name: profile.name,
    bio: profile.bio,
    avatar: profile.avatar,
    email: profile.email || undefined,
  },
  navigation: navigationContent.items,
  giscus: {
    repo: import.meta.env.PUBLIC_GISCUS_REPO,
    repoId: import.meta.env.PUBLIC_GISCUS_REPO_ID,
    category: import.meta.env.PUBLIC_GISCUS_CATEGORY,
    categoryId: import.meta.env.PUBLIC_GISCUS_CATEGORY_ID
  }
};
