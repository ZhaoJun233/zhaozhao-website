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
    // 等待入场动效（data-reveal 交错 + 0.72s 过渡）结束，避免 axe 把
    // 过渡中间态的透明度误判为对比度违规；未进入视口的元素保持
    // opacity: 0，axe 会将其视为不可见而跳过。
    await page.waitForTimeout(1600);
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

test("后台页面内容设置没有自动检测到的 WCAG A/AA 问题", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "认证后台检查只执行一次。");

  await page.goto("/admin/");
  await page.getByLabel("管理员密码").fill("233zhao-local-admin");
  await page.getByRole("button", { name: "进入后台" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "后台概览" })).toBeVisible();
  await page.goto("/admin/content/");
  await page.getByRole("button", { name: "首页天气与音乐" }).click();
  await expect(page.locator('[data-setting-editor][data-setting-key="now_page"]')).toBeVisible();

  const results = await new AxeBuilder({ page })
    .include("#admin-main")
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  expect(results.violations).toEqual([]);
});
