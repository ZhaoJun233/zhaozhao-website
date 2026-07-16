import { expect, test } from "@playwright/test";
import profile from "../../src/data/profile.json";
import taxonomy from "../../src/data/taxonomy.json";

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
  const imageBox = await page.getByTestId("home-hero-image").boundingBox();
  const copyBox = await page.getByTestId("hero-copy").boundingBox();

  expect(imageBox).not.toBeNull();
  expect(copyBox).not.toBeNull();
  expect(copyBox!.y).toBeGreaterThanOrEqual(imageBox!.y + imageBox!.height - 1);
});

test("home composition exposes its discovery landmarks", async ({ page }) => {
  await page.goto("/");

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

test("featured placeholder stays inside its card and uses the author wordmark", async ({ page }) => {
  await page.goto("/");
  const cardBox = await page.locator(".post-card--featured").boundingBox();
  const mediaBox = await page.locator(".post-card--featured .post-card__media").boundingBox();

  expect(cardBox).not.toBeNull();
  expect(mediaBox).not.toBeNull();
  expect(mediaBox!.width).toBeLessThanOrEqual(cardBox!.width + 1);
  await expect(page.locator(".post-card__wordmark strong")).toHaveText(profile.name);
});
