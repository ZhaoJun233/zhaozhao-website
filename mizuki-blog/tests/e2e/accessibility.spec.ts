import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const representativePages = [
  ["首页", "/"],
  ["文章索引", "/posts/"],
  ["文章详情", "/posts/astro-content-collections/"],
  ["项目", "/projects/"],
  ["关于", "/about/"],
  ["搜索", "/search/"],
] as const;

for (const [label, path] of representativePages) {
  test(`${label}没有自动检测到的 WCAG A/AA 问题`, async ({ page }) => {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    expect(results.violations).toEqual([]);
  });
}

test("主题选择会持久化且保持正确的颜色模式", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "切换配色主题" }).click();
  await page.getByRole("menuitemradio", { name: "深色" }).click();

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
