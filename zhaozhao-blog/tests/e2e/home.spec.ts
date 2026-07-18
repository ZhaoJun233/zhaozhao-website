import { expect, test } from "@playwright/test";
import profile from "../../src/data/profile.json" with { type: "json" };
import taxonomy from "../../src/data/taxonomy.json" with { type: "json" };

test("desktop hero keeps the complete source image visible", async ({ page }) => {
  await page.goto("/");
  const image = page.getByTestId("home-hero-image");

  await expect(page.locator(".site-brand")).toHaveText(profile.name);
  await expect(image).toBeVisible();
  await expect(image).toHaveCSS("object-fit", "contain");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(profile.name);
});

test("mobile moves copy below the artwork", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const headerBox = await page.locator("[data-site-header]").boundingBox();
  const imageBox = await page.getByTestId("home-hero-image").boundingBox();
  const copyBox = await page.getByTestId("hero-copy").boundingBox();

  expect(headerBox).not.toBeNull();
  expect(imageBox).not.toBeNull();
  expect(copyBox).not.toBeNull();
  expect(imageBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);
  expect(copyBox!.y).toBeGreaterThanOrEqual(imageBox!.y + imageBox!.height - 1);
});

test("home composition exposes its discovery landmarks", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("#weather-music")).toBeVisible();
  await expect(page.locator(".home-hero #weather-music")).toHaveCount(1);
  await expect(page.locator(".site-status + #weather-music")).toHaveCount(0);
  await expect(page.getByTestId("featured-posts")).toBeVisible();
  await expect(page.getByTestId("home-introduction")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(page.locator(".topic-list .topic-link")).toHaveCount(
    taxonomy.categories.length,
  );
  await expect(page.locator(".status-note")).toHaveText(
    taxonomy.categories.map(({ name }) => name).join(" · "),
  );
});

test("featured posts use a clean grid when the lead article has no cover", async ({ page }) => {
  await page.goto("/");

  const featuredPosts = page.getByTestId("featured-posts");
  const cards = featuredPosts.locator(".post-card");

  await expect(featuredPosts).toBeVisible();
  await expect(cards).toHaveCount(3);
  await expect(featuredPosts.locator(".posts-layout--grid .post-card")).toHaveCount(3);
  await expect(featuredPosts.locator(".post-card__media--placeholder")).toHaveCount(0);
  await expect(featuredPosts.locator(".post-card__wordmark")).toHaveCount(0);
  await expect(featuredPosts.locator(".empty-state")).toHaveCount(0);

  for (let index = 0; index < 3; index += 1) {
    const card = cards.nth(index);
    const titleLink = card.locator(".post-card__title a");
    await expect(card).toBeVisible();
    await expect(titleLink).toBeVisible();
    await expect(titleLink).toHaveText(/\S/);
    await expect(titleLink).toHaveAttribute("href", /^\/posts\/.+\/$/);
  }
});
