export type NavigationItem = { label: string; href: string };
export type SiteConfig = {
  name: string;
  title: string;
  description: string;
  locale: "zh-CN";
  timeZone: "Asia/Shanghai";
  siteUrl: string;
  pageSize: 8;
  author: { name: string; bio: string; email?: string };
  navigation: NavigationItem[];
  giscus: { repo?: string; repoId?: string; category?: string; categoryId?: string };
};

export const siteConfig: SiteConfig = {
  name: "Mizuki.",
  title: "Mizuki. - 动画、代码与生活碎片",
  description: "记录动画、开发与日常灵感的个人博客。",
  locale: "zh-CN",
  timeZone: "Asia/Shanghai",
  siteUrl: import.meta.env.PUBLIC_SITE_URL ?? "http://localhost:4321",
  pageSize: 8,
  author: { name: "Mizuki", bio: "在动画、代码与海风之间记录生活。" },
  navigation: [
    { label: "首页", href: "/" }, { label: "文章", href: "/posts/" },
    { label: "分类", href: "/categories/" }, { label: "归档", href: "/archive/" },
    { label: "项目", href: "/projects/" }, { label: "友链", href: "/friends/" },
    { label: "关于", href: "/about/" }, { label: "留言", href: "/guestbook/" }
  ],
  giscus: {
    repo: import.meta.env.PUBLIC_GISCUS_REPO,
    repoId: import.meta.env.PUBLIC_GISCUS_REPO_ID,
    category: import.meta.env.PUBLIC_GISCUS_CATEGORY,
    categoryId: import.meta.env.PUBLIC_GISCUS_CATEGORY_ID
  }
};
