import { expect, test } from "@playwright/test";

test("desktop hero keeps the complete source image visible", async ({ page }) => {
  await page.goto("/");
  const image = page.getByTestId("home-hero-image");

  await expect(image).toBeVisible();
  await expect(image).toHaveCSS("object-fit", "contain");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("233昭");
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
});
