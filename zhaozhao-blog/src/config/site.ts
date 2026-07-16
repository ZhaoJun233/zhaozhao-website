import profile from "../data/profile.json";
import { navigationContent } from "../data/content";

const profileImages = import.meta.glob<{ default: ImageMetadata }>(
  "../assets/profile/*.{avif,gif,jpeg,jpg,png,webp}",
  { eager: true },
);
const avatarFilename = profile.avatar.split("/").at(-1);
const avatarImage = Object.entries(profileImages).find(([path]) =>
  avatarFilename ? path.endsWith(`/${avatarFilename}`) : false,
)?.[1].default;

if (!avatarImage) {
  throw new Error(`Profile avatar does not exist: ${profile.avatar}`);
}

export type NavigationItem = { label: string; href: string };
export type SiteConfig = {
  name: string;
  title: string;
  description: string;
  locale: "zh-CN";
  timeZone: "Asia/Shanghai";
  siteUrl: string;
  pageSize: 8;
  author: { name: string; bio: string; avatar: ImageMetadata; email?: string };
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
    avatar: avatarImage,
  },
  navigation: navigationContent.items,
  giscus: {
    repo: import.meta.env.PUBLIC_GISCUS_REPO,
    repoId: import.meta.env.PUBLIC_GISCUS_REPO_ID,
    category: import.meta.env.PUBLIC_GISCUS_CATEGORY,
    categoryId: import.meta.env.PUBLIC_GISCUS_CATEGORY_ID
  }
};
