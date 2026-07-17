import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from "@playwright/test";

async function loginAsAdministrator(page: Page) {
  await page.goto("/admin/");
  await expect(page).toHaveURL(/\/admin\/login\/$/);
  await page.getByLabel("管理员密码").fill("233zhao-local-admin");
  await page.getByRole("button", { name: "进入后台" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "后台概览" })).toBeVisible();
}

async function startNewPost(page: Page) {
  await page.getByRole("button", { name: "新建文章" }).click();
  await expect(page.getByLabel("标题")).toBeFocused();
}

function postRowBySlug(page: Page, slug: string) {
  return page.locator("tr").filter({ hasText: `/${slug}/` });
}

async function waitForMediaStatus(
  request: APIRequestContext,
  url: string,
  status: number,
  timeout = 60_000,
): Promise<boolean> {
  const deadline = Date.now() + timeout;
  do {
    const separator = url.includes("?") ? "&" : "?";
    const response = await request.get(`${url}${separator}cleanup=${Date.now()}`);
    if (response.status() === status) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  return false;
}

async function cleanupPostsBySlug(page: Page, slugs: string[], warnings: string[]) {
  try {
    const response = await page.request.get("/api/admin/posts/");
    if (response.ok()) {
      const result = await response.json() as { data?: Array<{ id: string; slug: string }> };
      const targets = (result.data ?? []).filter(({ slug }) => slugs.includes(slug));
      for (const { id, slug } of targets) {
        const deletion = await page.request.delete(`/api/admin/posts/${id}/`);
        if (!deletion.ok()) warnings.push(`删除残留文章 ${slug} 返回 ${deletion.status()}。`);
      }
    } else {
      warnings.push(`读取残留文章返回 ${response.status()}。`);
    }
  } catch (error) {
    warnings.push(`读取或删除残留文章失败：${String(error)}`);
  }
}

async function cleanupArticleImageFixtures(
  page: Page,
  slugs: string[],
  draftTokens: string[],
  mediaUrls: string[],
  testInfo: TestInfo,
) {
  const warnings: string[] = [];
  await cleanupPostsBySlug(page, slugs, warnings);

  for (const token of new Set(draftTokens.filter(Boolean))) {
    try {
      const response = await page.request.delete(`/api/admin/post-assets/drafts/${token}/`);
      if (!response.ok()) warnings.push(`清理草稿 ${token} 返回 ${response.status()}。`);
    } catch (error) {
      warnings.push(`清理草稿 ${token} 失败：${String(error)}`);
    }
  }

  const cleanupResults = await Promise.all([...new Set(mediaUrls.filter(Boolean))].map(async (url) => {
    try {
      return await waitForMediaStatus(page.request, url, 404);
    } catch (error) {
      warnings.push(`检查媒体清理 ${url} 失败：${String(error)}`);
      return false;
    }
  }));
  if (cleanupResults.some((cleaned) => !cleaned)) warnings.push("部分媒体对象在清理等待窗口后仍可访问。");

  if (warnings.length > 0) {
    await testInfo.attach("article-image-cleanup-warnings", {
      body: warnings.join("\n"),
      contentType: "text/plain",
    });
  }
}

test("administrator manages friends and moderates guestbook messages", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "数据库写入流程只执行一次。" );
  const unique = `${Date.now()}-${testInfo.retry}-${Math.random().toString(36).slice(2, 10)}`;
  const friendName = `端到端友链-${unique}`;
  const visitorName = `留言访客-${unique}`;
  const importedSlug = `e2e-markdown-${unique}`;
  const importedTitle = `端到端 Markdown 导入 ${importedSlug}`;

  try {
    await loginAsAdministrator(page);
    await expect(page.getByRole("link", { name: "留言", exact: true })).toBeVisible();

    await page.goto("/admin/posts/");
    await page.locator("[data-import-post-file]").setInputFiles({
      name: `${importedSlug}.md`,
      mimeType: "text/markdown",
      buffer: Buffer.from(`---
title: ${importedTitle}
description: 验证后台能够直接导入 Markdown 文件。
publishedAt: 2026-07-16
category: 开发
tags: 测试, Markdown
---
导入正文。
`),
    });
    await expect(page.getByLabel("标题")).toHaveValue(importedTitle);
    await expect(page.getByLabel("Slug")).toHaveValue(importedSlug);
    await expect(page.getByLabel("摘要")).toHaveValue("验证后台能够直接导入 Markdown 文件。");
    await expect(page.getByRole("textbox", { name: "Markdown 正文" })).toHaveValue(/导入正文。/);
    await expect(page.getByLabel("保存为草稿")).toBeChecked();
    await page.getByRole("button", { name: "保存文章" }).click();
    const importedRow = postRowBySlug(page, importedSlug);
    await expect(importedRow).toContainText(importedTitle);
    await expect(importedRow.getByText("草稿", { exact: true })).toBeVisible();
    await importedRow.getByRole("button", { name: /删除/ }).click();
    await page.locator("[data-post-delete-dialog] [data-confirm-post-delete]").click();
    await expect(importedRow).toHaveCount(0);

    await page.goto("/admin/friends/");
    await page.getByLabel("站点名称").fill(friendName);
    await page.getByLabel("网址").fill("https://e2e-friend.example/");
    await page.getByLabel("介绍").fill("用于验证数据库友链管理。" );
    await page.getByLabel("兴趣标签").fill("测试, 博客");
    await page.getByLabel("在前台展示").uncheck();
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
    const submitted = page.waitForResponse((response) =>
      response.request().method() === "POST" && response.url().endsWith("/api/messages/"));
    await page.getByRole("button", { name: /提交留言/ }).click();
    expect((await submitted).status()).toBe(202);
    await expect(page.locator("[data-guestbook-status]")).toContainText("留言已提交");

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
  } finally {
    const warnings: string[] = [];
    await cleanupPostsBySlug(page, [importedSlug], warnings);
    if (warnings.length > 0) {
      await testInfo.attach("markdown-import-cleanup-warnings", {
        body: warnings.join("\n"),
        contentType: "text/plain",
      });
    }
  }
});

test("administrator manages article images", async ({ page, request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440", "数据库写入流程只执行一次。" );
  test.setTimeout(240_000);
  const unique = `${Date.now()}-${testInfo.retry}-${Math.random().toString(36).slice(2, 10)}`;
  const slug = `article-images-${unique}`;
  const sharedSlug = `shared-article-images-${unique}`;
  const title = `文章图片端到端测试 ${slug}`;
  const sharedTitle = `共享文章图片端到端测试 ${sharedSlug}`;
  const coverAlt = `端到端测试封面 ${slug}`;
  const draftTokens: string[] = [];
  const mediaUrls: string[] = [];

  try {
    await loginAsAdministrator(page);
    await page.goto("/admin/posts/");
    await startNewPost(page);
    draftTokens.push(await page.locator('input[name="draftToken"]').inputValue());
    await page.getByLabel("标题").fill(title);
    await page.getByLabel("Slug").fill(slug);
    await page.getByLabel("摘要").fill("验证封面、正文图片、共享引用与删除清理。");
    await page.getByLabel("分类").selectOption({ label: "开发" });
    await page.getByLabel("标签").fill("测试, 图片");
    await page.getByLabel("发布日期").fill("2026-07-17");
    const markdownBody = page.getByRole("textbox", { name: "Markdown 正文" });
    await markdownBody.fill("正文开始。\n");
    await page.locator("[data-post-cover-upload]").setInputFiles("tests/fixtures/post-cover.png");
    await page.getByLabel("封面说明").fill(coverAlt);
    await page.locator("[data-post-inline-upload]").setInputFiles("tests/fixtures/post-inline.png");
    await expect(markdownBody).toHaveValue(/!\[.*\]\(\/media\/uploads\//);
    const body = await markdownBody.inputValue();
    const inlineUrl = body.match(/\((\/media\/uploads\/[^)]+)\)/)?.[1];
    const coverUrl = await page.locator("[data-post-cover-preview] img").getAttribute("src");
    if (!inlineUrl || !coverUrl) throw new Error("文章图片 URL 未生成。");
    mediaUrls.push(coverUrl, inlineUrl);
    await page.getByLabel("保存为草稿").uncheck();
    await page.getByLabel("首页精选").check();
    await page.getByRole("button", { name: "保存文章" }).click();
    const firstRow = postRowBySlug(page, slug);
    await expect(firstRow).toContainText(title);

    await page.goto("/");
    const homeCover = page.getByAltText(coverAlt);
    await expect(homeCover).toBeVisible();
    await expect(homeCover).toHaveCSS("object-fit", "contain");

    await page.goto(`/posts/${slug}/`);
    const articleCover = page.getByAltText(coverAlt);
    await expect(articleCover).toBeVisible();
    await expect(articleCover).toHaveCSS("object-fit", "contain");
    await expect(page.locator(`img[src^="${inlineUrl}"]`)).toBeVisible();
    expect((await request.get(`${coverUrl}?render=${Date.now()}`)).status()).toBe(200);
    expect((await request.get(`${inlineUrl}?render=${Date.now()}`)).status()).toBe(200);
    const legacyInlineUrl = inlineUrl.endsWith("/") ? inlineUrl.slice(0, -1) : inlineUrl;
    const legacyInlineResponse = await request.get(legacyInlineUrl, { maxRedirects: 0 });
    expect(legacyInlineResponse.status()).toBe(308);
    expect(legacyInlineResponse.headers().location).toMatch(/\/media\/uploads\/.+\/$/);

    await page.goto("/admin/posts/");
    await startNewPost(page);
    draftTokens.push(await page.locator('input[name="draftToken"]').inputValue());
    await page.getByLabel("标题").fill(sharedTitle);
    await page.getByLabel("Slug").fill(sharedSlug);
    await page.getByLabel("摘要").fill("验证共享图片在删除其他文章后继续保留。");
    await page.getByLabel("分类").selectOption({ label: "开发" });
    await page.getByLabel("标签").fill("测试, 共享图片");
    await page.getByLabel("发布日期").fill("2026-07-17");
    await page.getByRole("textbox", { name: "Markdown 正文" }).fill(`![共享图片](${inlineUrl})`);
    await page.getByRole("button", { name: "保存文章" }).click();
    const sharedRow = postRowBySlug(page, sharedSlug);
    await expect(sharedRow).toContainText(sharedTitle);

    await firstRow.getByRole("button", { name: "删除" }).click();
    const deleteDialog = page.locator("[data-post-delete-dialog]");
    await expect(deleteDialog).toContainText("1 张共享图片会继续保留");
    await deleteDialog.locator("[data-confirm-post-delete]").click();
    await expect(firstRow).toHaveCount(0);

    await expect.poll(async () => (
      await request.get(`${coverUrl}?cleanup=${Date.now()}`)
    ).status(), { timeout: 60_000 }).toBe(404);
    expect((await request.get(`${inlineUrl}?shared=${Date.now()}`)).status()).toBe(200);

    await sharedRow.getByRole("button", { name: "删除" }).click();
    await page.locator("[data-post-delete-dialog] [data-confirm-post-delete]").click();
    await expect(sharedRow).toHaveCount(0);
    await expect.poll(async () => (
      await request.get(`${inlineUrl}?cleanup=${Date.now()}`)
    ).status(), { timeout: 60_000 }).toBe(404);
  } finally {
    await cleanupArticleImageFixtures(
      page,
      [slug, sharedSlug],
      draftTokens,
      mediaUrls,
      testInfo,
    );
  }
});

test("article editor stays operable without horizontal overflow", async ({ page }) => {
  await loginAsAdministrator(page);
  await page.goto("/admin/posts/");
  await startNewPost(page);

  const title = page.getByLabel("标题");
  const markdownBody = page.getByRole("textbox", { name: "Markdown 正文" });
  await title.fill("响应式编辑器检查");
  await markdownBody.fill("响应式 smoke 不保存文章，也不重复图片生命周期。\n");
  await expect(title).toHaveValue("响应式编辑器检查");
  await expect(markdownBody).toHaveValue(/响应式 smoke/);

  for (const button of [
    page.locator("[data-post-cover-browse]"),
    page.locator("[data-post-inline-browse]"),
  ]) {
    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);

    const fileChooserPromise = page.waitForEvent("filechooser");
    await button.click();
    await (await fileChooserPromise).setFiles([]);
  }

  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const documentWidth = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(documentWidth.clientWidth).toBe(viewport!.width);
  expect(documentWidth.scrollWidth).toBeLessThanOrEqual(documentWidth.clientWidth);
});

test("mobile cover picker shows upload feedback and a preview", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "手机上传流程只在一个窄屏尺寸执行。" );
  await loginAsAdministrator(page);
  await page.goto("/admin/posts/");
  await startNewPost(page);
  const draftToken = await page.locator('input[name="draftToken"]').inputValue();
  let slug = "";

  try {
    await page.getByLabel("标题").fill("手机图片保存测试");
    slug = await page.getByLabel("Slug").inputValue();
    await page.getByLabel("摘要").fill("验证手机选择封面、预览与保存流程。");
    await page.getByLabel("分类").selectOption({ index: 1 });
    await page.getByLabel("标签").fill("测试, 手机");
    await page.getByRole("textbox", { name: "Markdown 正文" }).fill("手机图片保存测试正文。");
    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator("[data-post-cover-browse]").click();
    await (await chooserPromise).setFiles("tests/fixtures/post-cover.png");

    await expect(page.locator("[data-post-cover-image]")).toBeVisible();
    await expect(page.locator("[data-post-cover-status]")).toContainText(/正在上传|封面已上传/);
    await expect(page.locator("[data-post-cover-status]")).toBeVisible();
    await page.getByRole("button", { name: "保存文章" }).click();
    await expect(postRowBySlug(page, slug)).toContainText("手机图片保存测试");
  } finally {
    const warnings: string[] = [];
    if (slug) await cleanupPostsBySlug(page, [slug], warnings);
    await page.request.delete(`/api/admin/post-assets/drafts/${draftToken}/`);
    if (warnings.length > 0) {
      await testInfo.attach("mobile-cover-cleanup-warnings", {
        body: warnings.join("\n"),
        contentType: "text/plain",
      });
    }
  }
});
