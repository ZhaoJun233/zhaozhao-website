import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/admin/");
  await page.getByLabel("管理员密码").fill("233zhao-local-admin");
  await page.getByRole("button", { name: "进入后台" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "后台概览" })).toBeVisible();
}

test("homepage shows visitor weather and one selected NetEase player", async ({
  page,
  context,
}, testInfo) => {
  const unique = `${Date.now()}${testInfo.retry}${testInfo.project.name.replace(/\D/g, "")}`.slice(0, 18);
  const title = `此刻选曲-${unique}`;
  let trackId = "";
  const weatherRequests: string[] = [];

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 30.2741, longitude: 120.1551 });
  await page.route("**/api/weather**", async (route) => {
    weatherRequests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          area: "杭州",
          code: 2,
          condition: "多云",
          temperature: 28.4,
          apparentTemperature: 31.2,
          humidity: 72,
          windDirection: 135,
          windSpeed: 11.6,
          observedAt: "2026-07-18T10:30",
        },
      }),
    });
  });

  try {
    await login(page);
    const create = await page.request.post("/api/admin/music/", {
      data: {
        title,
        artist: "测试歌手",
        neteaseSongId: unique,
        note: "让海风替我播放。",
        enabled: true,
      },
    });
    expect(create.ok()).toBe(true);
    trackId = ((await create.json()) as { data: { id: string } }).data.id;

    await page.goto("/");
    await expect(page.locator("#weather-music")).toBeVisible();
    await expect(page.locator("#weather-music")).toHaveAttribute("aria-label", "天气与音乐");
    const drawerToggle = page.locator("[data-weather-music-toggle]");
    if (testInfo.project.name === "mobile-390") {
      await expect(drawerToggle).toHaveAttribute("aria-expanded", "false");
      await drawerToggle.click();
    }
    await expect(page.locator("#weather-music iframe")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "访客天气" })).toBeVisible();
    await expect(page.getByRole("region", { name: "233昭的今日选曲" })).toBeVisible();
    await expect(page.locator("[data-now-time], [data-now-date], [data-now-greeting]")).toHaveCount(0);
    await expect(page.getByText("杭州", { exact: true })).toBeVisible();
    await expect.poll(() => weatherRequests.some((url) => (
      url.includes("lat=30.2741") && url.includes("lon=120.1551")
    ))).toBe(true);
    await expect(page.locator("iframe[src*='music.163.com/outchain/player']")).toHaveCount(0);

    const track = page.getByRole("button", { name: new RegExp(title) });
    await track.click();
    await expect(track).toHaveAttribute("aria-pressed", "true");
    const iframe = page.locator("iframe[src*='music.163.com/outchain/player']");
    await expect(iframe).toHaveCount(1);
    await expect(iframe).toHaveAttribute("src", new RegExp(`id=${unique}`));
    await track.click();
    await expect(iframe).toHaveCount(1);

    if (testInfo.project.name === "mobile-390") {
      const weatherBox = await page.locator("[data-home-section='weather']").boundingBox();
      const musicBox = await page.locator("[data-home-section='music']").boundingBox();
      expect(weatherBox).not.toBeNull();
      expect(musicBox).not.toBeNull();
      expect(weatherBox!.y).toBeLessThan(musicBox!.y);
      expect((await track.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const currentLinkBox = await page.locator("[data-current-link]").boundingBox();
      expect(currentLinkBox).not.toBeNull();
      expect(currentLinkBox!.height).toBeGreaterThanOrEqual(44);
      expect(currentLinkBox!.width).toBeGreaterThanOrEqual(44);
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    if (trackId) {
      const status = await page.evaluate(async (id) => {
        const response = await fetch(`/api/admin/music/${id}/`, { method: "DELETE" });
        return response.status;
      }, trackId);
      expect(status).toBe(200);
    }
  }
});

test("Hero drawer defaults responsively and exposes an accessible toggle", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const toggle = page.locator("[data-weather-music-toggle]");
  const panel = page.locator("#hero-weather-music-panel");

  await expect(page.locator(".home-hero #weather-music")).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-controls", "hero-weather-music-panel");

  if (testInfo.project.name === "mobile-390") {
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toHaveAttribute("inert", "");
    const box = await toggle.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(panel).not.toHaveAttribute("inert", "");
  } else {
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(panel).not.toHaveAttribute("inert", "");
  }
});

test("stored Hero drawer preference overrides the desktop default", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name === "mobile-390", "Desktop default coverage only.");
  await page.goto("/");
  const toggle = page.locator("[data-weather-music-toggle]");
  const panel = page.locator("#hero-weather-music-panel");

  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.reload();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toHaveAttribute("inert", "");
});

test("mobile weather refreshes only while the Hero drawer is open and visible", async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-390", "Mobile closed-default lifecycle coverage.");
  await page.clock.install({ time: new Date("2026-07-18T10:00:00+08:00") });
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 31.1837, longitude: 121.4365 });
  const requests: string[] = [];
  await page.route("**/api/weather**", async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          area: "徐汇区 · 上海市",
          code: 2,
          condition: "多云",
          temperature: 28.4,
          apparentTemperature: 31.2,
          humidity: 72,
          windDirection: 135,
          windSpeed: 11.6,
          observedAt: "2026-07-18T10:00",
        },
      }),
    });
  });

  await page.goto("/");
  const toggle = page.locator("[data-weather-music-toggle]");
  expect(requests).toHaveLength(0);

  await toggle.click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toContain("lat=31.1837");
  expect(requests[0]).toContain("lon=121.4365");

  await page.clock.fastForward(600_000);
  await expect.poll(() => requests.length).toBe(2);

  await toggle.click();
  const closedRequestCount = requests.length;
  await page.clock.fastForward(600_000);
  expect(requests).toHaveLength(closedRequestCount);

  await toggle.click();
  await expect.poll(() => requests.length).toBe(closedRequestCount + 1);
});

test("weather refresh failure preserves the last successful snapshot", async ({
  page,
}, testInfo) => {
  await page.clock.install({ time: new Date("2026-07-18T10:00:00+08:00") });
  let requests = 0;
  await page.route("**/api/weather**", async (route) => {
    requests += 1;
    if (requests > 1) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "天气暂时藏进云里了。" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          area: "徐汇区 · 上海市",
          code: 2,
          condition: "多云",
          temperature: 28.4,
          apparentTemperature: 31.2,
          humidity: 72,
          windDirection: 135,
          windSpeed: 11.6,
          observedAt: "2026-07-18T10:00",
        },
      }),
    });
  });

  await page.goto("/");
  if (testInfo.project.name === "mobile-390") {
    await page.locator("[data-weather-music-toggle]").click();
  }
  await expect(page.locator("[data-weather-area]")).toHaveText("徐汇区 · 上海市");
  await expect(page.locator("[data-weather-temperature]")).toHaveText("28°");

  await page.clock.fastForward(600_000);
  await expect(page.locator("[data-weather-refresh-status]")).toHaveText("更新暂时失败");
  await expect(page.locator("[data-weather-area]")).toHaveText("徐汇区 · 上海市");
  await expect(page.locator("[data-weather-temperature]")).toHaveText("28°");
});

test("legacy now route redirects to the homepage section", async ({ page }) => {
  const response = await page.goto("/now/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/#weather-music$/);
  await expect(page.locator("#weather-music")).toBeVisible();
});
