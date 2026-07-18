import { expect, test, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/admin/");
  await page.getByLabel("管理员密码").fill("233zhao-local-admin");
  await page.getByRole("button", { name: "进入后台" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "后台概览" })).toBeVisible();
}

test("sea window shows local time, visitor weather, and one selected NetEase player", async ({
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

    await page.goto("/now/");
    await expect(page.getByRole("heading", { level: 1, name: "此刻" })).toBeVisible();
    await expect(page.getByLabel("当前时间")).toBeVisible();
    await expect(page.getByRole("region", { name: "访客天气" })).toBeVisible();
    await expect(page.getByRole("region", { name: "233昭的今日选曲" })).toBeVisible();
    await expect(page.getByText("杭州", { exact: true })).toBeVisible();
    await expect.poll(() => weatherRequests.some((url) => url.includes("lat=30.2741") && url.includes("lon=120.1551")))
      .toBe(true);
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
      const timeBox = await page.locator("[data-now-section='time']").boundingBox();
      const weatherBox = await page.locator("[data-now-section='weather']").boundingBox();
      const musicBox = await page.locator("[data-now-section='music']").boundingBox();
      expect(timeBox!.y).toBeLessThan(weatherBox!.y);
      expect(weatherBox!.y).toBeLessThan(musicBox!.y);
      expect((await track.boundingBox())!.height).toBeGreaterThanOrEqual(44);
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
