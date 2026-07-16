import { expect, test } from "@playwright/test";

test("header search opens the runtime search page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "搜索" }).click();

  await expect(page).toHaveURL(/\/search\/$/);
  await expect(page.getByRole("searchbox", { name: "搜索文章" })).toBeVisible();
});

test("runtime search finds article body text", async ({ page }) => {
  await page.goto("/search/");
  await page.getByRole("searchbox", { name: "搜索文章" }).fill("Content Collections");
  await page.getByRole("button", { name: "搜索" }).click();

  await expect(page).toHaveURL(/q=Content(?:\+|%20)Collections/);
  await expect(page.getByRole("link", { name: /用 Astro Content Collections 整理个人写作/ }))
    .toBeVisible();
});

test("runtime search shows a helpful empty state", async ({ page }) => {
  await page.goto("/search/?q=没有任何文章会包含-9f3c1a");

  await expect(page.getByRole("heading", { name: /找到 0 篇文章/ })).toBeVisible();
  await expect(page.getByText("换一个关键词，或从分类和标签入口继续浏览。", { exact: true }))
    .toBeVisible();
});

test("search API supports category and tag filters", async ({ request }) => {
  const category = await request.get("/api/search?category=生活");
  expect(category.ok()).toBe(true);
  expect((await category.json()).map((post: { data: { title: string } }) => post.data.title))
    .toEqual(["一个安静周末的光影与歌单"]);

  const tag = await request.get("/api/search?tag=阅读");
  expect(tag.ok()).toBe(true);
  expect((await tag.json()).length).toBeGreaterThan(0);
});
