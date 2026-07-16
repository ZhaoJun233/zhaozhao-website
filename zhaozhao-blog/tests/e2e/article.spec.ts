import { expect, test } from "@playwright/test";

const articlePath = "/posts/astro-content-collections/";

test("article renders linked contents and adjacent navigation", async ({ page }) => {
  await page.goto(articlePath);

  await expect(
    page.getByRole("heading", { level: 1, name: "用 Astro Content Collections 整理个人写作" }),
  ).toBeVisible();

  const visibleContents = page.locator("[data-table-of-contents]:visible");
  await expect(visibleContents).toBeVisible();
  const links = visibleContents.locator("[data-toc-link]");
  const linkCount = await links.count();
  expect(linkCount).toBeGreaterThan(0);

  for (let index = 0; index < linkCount; index += 1) {
    const hash = await links.nth(index).getAttribute("href");
    expect(hash).toMatch(/^#.+/);
    const targetExists = await page.evaluate((targetHash) => {
      return document.getElementById(decodeURIComponent(targetHash.slice(1))) !== null;
    }, hash!);
    expect(targetExists).toBe(true);
  }

  await expect(page.getByRole("link", { name: /上一篇/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /下一篇/ })).toBeVisible();
});

test("reading progress advances while scrolling", async ({ page }) => {
  await page.goto(articlePath);
  const progress = page.getByRole("progressbar", { name: "文章阅读进度" });
  const initialValue = Number(await progress.getAttribute("aria-valuenow"));

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

  await expect.poll(async () => Number(await progress.getAttribute("aria-valuenow"))).toBeGreaterThan(initialValue);
});

test("code copy writes the rendered source to the clipboard", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          (window as Window & { __copiedCode?: string }).__copiedCode = value;
        },
      },
    });
  });
  await page.goto(articlePath);

  const copyButton = page.getByRole("button", { name: "复制代码" }).first();
  await copyButton.click();
  await expect(copyButton).toHaveText("已复制");
  await expect.poll(() => page.evaluate(() => (
    window as Window & { __copiedCode?: string }
  ).__copiedCode)).toContain("const post = z.object");
});

test("missing Giscus configuration hides the discussion area and its client", async ({ page }) => {
  const giscusRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("giscus.app/client.js")) giscusRequests.push(request.url());
  });

  await page.goto(articlePath);
  await expect(page.getByRole("heading", { name: "评论", exact: true })).toHaveCount(0);
  await expect(page.getByText("评论功能尚未配置", { exact: true })).toHaveCount(0);
  expect(giscusRequests).toEqual([]);
  await expect(page.locator('script[src="https://giscus.app/client.js"]')).toHaveCount(0);
});
