import { expect, test } from "@playwright/test";

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "数据库写入流程只执行一次。" );
});

test("administrator manages friends and moderates guestbook messages", async ({ page }) => {
  const friendName = `端到端友链-${Date.now()}`;
  const visitorName = `留言访客-${Date.now()}`;

  await page.goto("/admin/");
  await expect(page).toHaveURL(/\/admin\/login\/$/);
  await page.getByLabel("管理员密码").fill("233zhao-local-admin");
  await page.getByRole("button", { name: "进入后台" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "后台概览" })).toBeVisible();
  await expect(page.getByRole("link", { name: "留言", exact: true })).toBeVisible();

  await page.goto("/admin/friends/");
  await page.getByLabel("站点名称").fill(friendName);
  await page.getByLabel("网址").fill("https://e2e-friend.example/");
  await page.getByLabel("介绍").fill("用于验证数据库友链管理。" );
  await page.getByLabel("兴趣标签").fill("测试, 博客");
  await page.getByRole("button", { name: /保存友链/ }).click();
  await expect(page.getByText(friendName, { exact: true })).toBeVisible();

  const friendRow = page.locator("tr").filter({ hasText: friendName });
  page.once("dialog", (dialog) => dialog.accept());
  await friendRow.getByRole("button", { name: /删除/ }).click();
  await expect(page.getByText(friendName, { exact: true })).toHaveCount(0);

  await page.goto("/guestbook/");
  await page.getByLabel("昵称 *").fill(visitorName);
  await page.getByLabel("邮箱").fill("e2e@example.com");
  await page.getByLabel("留言 *").fill("这是一条端到端数据库留言。" );
  await page.getByRole("button", { name: /提交留言/ }).click();
  await expect(page.getByText(/审核后/)).toBeVisible();

  await page.goto("/admin/messages/");
  const messageRow = page.locator("tr").filter({ hasText: visitorName });
  await expect(messageRow).toBeVisible();
  await messageRow.getByRole("button", { name: "公开" }).click();
  await expect(page.locator("tr").filter({ hasText: visitorName }).getByText("已公开"))
    .toBeVisible();

  await page.goto("/guestbook/");
  const publicMessage = page.locator(".guestbook-messages li").filter({ hasText: visitorName });
  await expect(publicMessage.getByText(visitorName, { exact: true })).toBeVisible();
  await expect(publicMessage.getByText("这是一条端到端数据库留言。", { exact: true }))
    .toBeVisible();

  await page.goto("/admin/messages/");
  const publishedRow = page.locator("tr").filter({ hasText: visitorName });
  page.once("dialog", (dialog) => dialog.accept());
  await publishedRow.getByRole("button", { name: "删除" }).click();
  await expect(page.getByText(visitorName, { exact: true })).toHaveCount(0);
});
