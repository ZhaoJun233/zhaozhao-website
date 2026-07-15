import { expect, test, type Page } from "@playwright/test";

async function openGlobalSearch(page: Page) {
  await page.goto("/");
  await page.keyboard.press("/");

  const dialog = page.getByRole("dialog", { name: "全站搜索" });
  await expect(dialog).toBeVisible();

  const searchbox = dialog.getByRole("searchbox", { name: "搜索文章" });
  await expect(searchbox).toBeFocused();
  return { dialog, searchbox };
}

test("search finds Chinese article body text", async ({ page }) => {
  const { dialog, searchbox } = await openGlobalSearch(page);

  await searchbox.fill("Content Collections");

  await expect(
    dialog.getByRole("link", { name: /用 Astro Content Collections 整理个人写作/ }),
  ).toBeVisible();
});

test("Escape closes search and restores focus to the header opener", async ({ page }) => {
  await page.goto("/");
  const opener = page.getByRole("link", { name: "搜索" });

  await opener.click();
  await expect(page.getByRole("dialog", { name: "全站搜索" })).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog", { name: "全站搜索" })).toBeHidden();
  await expect(opener).toBeFocused();
});

test("search announces a helpful empty state", async ({ page }) => {
  await page.goto("/search/");
  await page.getByRole("searchbox", { name: "搜索文章" }).fill("没有任何文章会包含-9f3c1a");

  await expect(page.getByText("没有找到匹配的内容", { exact: true })).toBeVisible();
  await expect(page.getByText("换个关键词，或减少筛选条件再试试。", { exact: true })).toBeVisible();
});

test("category filtering matches the selected category exactly", async ({ page }) => {
  await page.goto("/search/");

  await page.getByRole("combobox", { name: "分类" }).selectOption({ label: "生活" });

  await expect(page.getByRole("link", { name: /一个安静周末的光影与歌单/ })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /用 Astro Content Collections 整理个人写作/ }),
  ).toHaveCount(0);
});

test("tag filters use OR matching", async ({ page }) => {
  await page.goto("/search/");

  await page.getByRole("checkbox", { name: "音乐" }).check();
  await page.getByRole("checkbox", { name: "阅读" }).check();

  await expect(page.getByRole("link", { name: /一个安静周末的光影与歌单/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /我的长文阅读与摘录流程/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /克制的网页动画/ })).toHaveCount(0);
});

test("arrow keys move focus from the query through search results", async ({ page }) => {
  const { dialog, searchbox } = await openGlobalSearch(page);
  await searchbox.fill("Astro");

  const resultLinks = dialog.locator("[data-search-result-link]");
  await expect(resultLinks.first()).toBeVisible();
  expect(await resultLinks.count()).toBeGreaterThan(1);

  await searchbox.press("ArrowDown");
  await expect(resultLinks.first()).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(resultLinks.nth(1)).toBeFocused();
});

test("Pagefind stays lazy until search receives input", async ({ page }) => {
  const pagefindRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/pagefind/pagefind.js")) pagefindRequests.push(request.url());
  });

  const { dialog, searchbox } = await openGlobalSearch(page);
  await page.waitForTimeout(250);
  expect(pagefindRequests).toEqual([]);

  await searchbox.fill("Content Collections");
  await expect(dialog.getByRole("link", { name: /整理个人写作/ })).toBeVisible();
  expect(pagefindRequests).toHaveLength(1);
});

test("dialog traps focus and backdrop click restores the opener", async ({ page }) => {
  await page.goto("/");
  const opener = page.getByRole("link", { name: "搜索" });
  await opener.click();

  const dialog = page.getByRole("dialog", { name: "全站搜索" });
  const closeButton = dialog.getByRole("button", { name: "关闭搜索" });
  await closeButton.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "清除条件" })).toBeFocused();

  await page.mouse.click(1, 1);
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("slash shortcut ignores editable targets and modifier keys", async ({ page }) => {
  await page.goto("/search/");
  const searchbox = page.getByRole("searchbox", { name: "搜索文章" });

  await searchbox.focus();
  await page.keyboard.type("/");
  await expect(searchbox).toHaveValue("/");
  await expect(page.getByRole("dialog", { name: "全站搜索" })).toBeHidden();

  const textarea = page.locator("textarea[data-shortcut-fixture]");
  await page.locator("main").evaluate((main) => {
    const field = document.createElement("textarea");
    field.dataset.shortcutFixture = "";
    main.prepend(field);
  });
  await textarea.focus();
  await page.keyboard.type("/");
  await expect(textarea).toHaveValue("/");
  await expect(page.getByRole("dialog", { name: "全站搜索" })).toBeHidden();

  const editable = page.locator("[data-contenteditable-fixture]");
  await page.locator("main").evaluate((main) => {
    const field = document.createElement("div");
    field.contentEditable = "true";
    field.dataset.contenteditableFixture = "";
    main.prepend(field);
  });
  await editable.focus();
  await page.keyboard.type("/");
  await expect(editable).toHaveText("/");
  await expect(page.getByRole("dialog", { name: "全站搜索" })).toBeHidden();

  await page.locator("main").focus();
  await page.keyboard.press("Control+/");
  await expect(page.getByRole("dialog", { name: "全站搜索" })).toBeHidden();
});
