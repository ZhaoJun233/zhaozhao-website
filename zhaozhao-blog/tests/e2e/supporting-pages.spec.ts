import { expect, test } from "@playwright/test";
import profile from "../../src/data/profile.json" with { type: "json" };

test("client navigation keeps the page alive and initializes guestbook behavior", async ({ page }) => {
  await page.route("**/api/messages/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "测试留言已提交。" }),
    });
  });
  await page.goto("/");
  await page.evaluate(() => {
    (window as typeof window & { __clientRouteProbe?: string }).__clientRouteProbe = "kept";
  });

  await page.locator("footer a[href='/guestbook/']").click();
  await expect(page).toHaveURL(/\/guestbook\/$/);
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __clientRouteProbe?: string }
  ).__clientRouteProbe)).toBe("kept");

  await page.getByLabel("昵称 *").fill("测试访客");
  await page.getByLabel("留言 *").fill("客户端导航后的留言测试");
  await page.getByRole("button", { name: /提交留言/ }).click();
  await expect(page.getByText("测试留言已提交。", { exact: true })).toBeVisible();
});

test("client navigation registers the global scroll handler only once", async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.addEventListener.bind(window);
    let scrollRegistrations = 0;
    window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      if (type === "scroll") scrollRegistrations += 1;
      original(type, listener, options);
    }) as typeof window.addEventListener;
    Object.defineProperty(window, "__scrollRegistrations", {
      configurable: true,
      get: () => scrollRegistrations,
    });
  });

  await page.goto("/");
  const initial = await page.evaluate(() => (
    window as typeof window & { __scrollRegistrations: number }
  ).__scrollRegistrations);

  for (const path of ["/posts/", "/categories/", "/archive/", "/"]) {
    await page.evaluate((href) => {
      document.querySelector<HTMLAnchorElement>(`header a[href='${href}']`)?.click();
    }, path);
    await expect(page).toHaveURL(new RegExp(path === "/" ? "/$" : path));
  }

  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __scrollRegistrations: number }
  ).__scrollRegistrations)).toBe(initial);
});

test("project filters expose one active status and a live result count", async ({ page }) => {
  await page.goto("/projects/");

  const projectCards = page.locator("[data-project-card]");
  const resultCount = page.getByRole("status", { name: "项目筛选结果" });

  await expect(projectCards).toHaveCount(3);
  await expect(resultCount).toContainText("3 个项目");

  const activeFilter = page.getByRole("button", { name: "进行中" });
  await activeFilter.click();

  await expect(activeFilter).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "全部" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(projectCards.filter({ visible: true })).toHaveCount(2);
  await expect(resultCount).toContainText("2 个项目");

  await page.getByRole("button", { name: "已归档" }).click();
  await expect(projectCards.filter({ visible: true })).toHaveCount(0);
  await expect(resultCount).toContainText("0 个项目");
  await expect(page.getByText("这个状态下还没有项目", { exact: true })).toBeVisible();
});

test("project cards link to statically generated detail pages", async ({ page }) => {
  await page.goto("/projects/");
  await page.getByRole("link", { name: "查看项目：Anime Watchlist" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Anime Watchlist" }),
  ).toBeVisible();
  await expect(page.getByText("按观看状态、季节与个人笔记整理动画条目的轻量清单概念。"))
    .toBeVisible();
});

test("friends page labels all four cards as demonstration data", async ({ page }) => {
  await page.goto("/friends/");

  await expect(page.getByText(/以下友链为演示数据/)).toBeVisible();
  const friendCards = page.locator("[data-friend-card]");
  await expect(friendCards).toHaveCount(4);
  await expect(page.getByRole("link", { name: /春潮放映室/ })).toHaveAttribute(
    "href",
    "https://spring-screen.example/",
  );
});

test("about page prominently presents the author and approved artwork source", async ({ page }) => {
  await page.goto("/about/");

  await expect(page.getByRole("heading", { level: 1, name: profile.name })).toBeVisible();
  await expect(page.getByRole("img", { name: `${profile.name} 的头像` })).toBeVisible();
  await expect(page.getByRole("link", { name: "zhaozhao7991@gmail.com" })).toHaveAttribute(
    "href",
    "mailto:zhaozhao7991@gmail.com",
  );
  await expect(page.getByRole("img", { name: "粉紫色海边的白发少女插画" })).toBeVisible();
  await expect(page.getByRole("link", { name: /查看《【动态壁纸】夏日白色绮梦》来源/ }))
    .toHaveAttribute("href", "https://www.bilibili.com/video/BV1NCjx6oEhj/");
  await expect(page.getByText("2026.07.15", { exact: true })).toHaveCount(2);
  await expect(page.getByRole("heading", { level: 3, name: "开始搭建个人博客" }))
    .toBeVisible();
});

test("guestbook renders the native database message form", async ({ page }) => {
  await page.goto("/guestbook/");

  await expect(page.getByRole("heading", { level: 1, name: "留言簿" })).toBeVisible();
  await expect(page.getByLabel("昵称 *")).toBeVisible();
  await expect(page.getByLabel("留言 *")).toBeVisible();
  await expect(page.getByRole("button", { name: /提交留言/ })).toBeVisible();
});

test("credits records the exact approved Bilibili artwork metadata", async ({ page }) => {
  await page.goto("/credits/");

  await expect(page.getByText(`${profile.name}首页主视觉`, { exact: true })).toBeVisible();
  await expect(page.getByText("BV1NCjx6oEhj", { exact: true })).toBeVisible();
  await expect(page.getByText("清水未萌_Minamo", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /原始页面/ })).toHaveAttribute(
    "href",
    "https://www.bilibili.com/video/BV1NCjx6oEhj/",
  );
});

test("credits omits the Giscus environment setup section", async ({ page }) => {
  await page.goto("/credits/");
  await expect(page.getByRole("heading", { name: "用四个环境变量打开讨论区" })).toHaveCount(0);
  await expect(page.locator("#giscus-setup")).toHaveCount(0);
  await expect(page.getByText("Giscus", { exact: true })).toHaveCount(0);
});

test("404 page offers direct home and search recovery", async ({ page }) => {
  await page.goto("/missing-supporting-route/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("404");
  await expect(page.getByRole("link", { name: "返回首页" })).toHaveAttribute("href", "/");
  await expect(page.getByRole("link", { name: "搜索文章" })).toHaveAttribute(
    "href",
    "/search/",
  );
  await expect(page.getByRole("heading", { level: 2, name: "最近写下" })).toBeVisible();
});

test("RSS contains all six published posts", async ({ request }) => {
  const response = await request.get("/rss.xml");
  expect(response.ok()).toBe(true);

  const xml = await response.text();
  expect(xml.match(/<item>/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  expect(xml).toContain("七月动画随记：把喜欢的片段留住");
  expect(xml).toContain('<?xml-stylesheet href="/rss-feed.xsl" type="text/xsl"?>');
  expect((await request.get("/rss-feed.xsl")).ok()).toBe(true);
});

test("RSS opens as a readable article index in a browser", async ({ page }) => {
  await page.goto("/rss.xml");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("233昭");
  await expect(page.getByText("最近更新", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /返回博客首页/ })).toHaveAttribute(
    "href",
    "https://zhao233.de5.net/",
  );
  expect(await page.getByRole("listitem").count()).toBeGreaterThanOrEqual(6);
});

test("robots.txt advertises the configured sitemap URL", async ({ request }) => {
  const response = await request.get("/robots.txt");
  expect(response.ok()).toBe(true);

  await expect(response.text()).resolves.toContain(
    "/sitemap.xml",
  );
});

test("runtime sitemap contains current content routes", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.ok()).toBe(true);
  const xml = await response.text();
  expect(xml).toContain("/posts/summer-anime-notes/");
  expect(xml).toContain("/projects/zhaozhao-blog/");
  expect(xml).toContain("/friends/");
});

test("legacy now route keeps old links working", async ({ request }) => {
  const response = await request.get("/now/", { maxRedirects: 0 });
  expect(response.status()).toBe(308);
  expect(response.headers().location).toBe("/#weather-music");
});

test("sitemap no longer advertises the standalone now page", async ({ request }) => {
  const response = await request.get("/sitemap.xml");
  expect(response.ok()).toBe(true);
  expect(await response.text()).not.toContain("/now/");
});

test("web app manifest derives the editable author identity", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");

  const manifest = await response.json();
  expect(manifest).toMatchObject({
    name: `${profile.name} - ${profile.siteTitle}`,
    short_name: profile.name,
    description: profile.description,
  });
});
