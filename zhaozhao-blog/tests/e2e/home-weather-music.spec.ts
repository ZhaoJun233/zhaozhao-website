import { expect, test, type Page, type Route } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/admin/");
  await page.getByLabel("管理员密码").fill("233zhao-local-admin");
  await page.getByRole("button", { name: "进入后台" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "后台概览" })).toBeVisible({
    timeout: 15_000,
  });
}

function usesMobileDrawer(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) <= 899;
}

function silentWav(seconds = 60): Buffer {
  const sampleRate = 8_000;
  const dataSize = sampleRate * seconds * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  return buffer;
}

async function fulfillSilentAudio(route: Route): Promise<void> {
  const audio = silentWav();
  const range = route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
  if (!range) {
    await route.fulfill({
      status: 200,
      contentType: "audio/wav",
      headers: { "Accept-Ranges": "bytes", "Content-Length": String(audio.length) },
      body: audio,
    });
    return;
  }
  const start = Number(range[1]);
  const end = range[2] ? Math.min(Number(range[2]), audio.length - 1) : audio.length - 1;
  const body = audio.subarray(start, end + 1);
  await route.fulfill({
    status: 206,
    contentType: "audio/wav",
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Length": String(body.length),
      "Content-Range": `bytes ${start}-${end}/${audio.length}`,
    },
    body,
  });
}

test("header weather uses the visitor endpoint and stays out of compact navigation", async ({
  page,
}) => {
  await page.route("**/api/weather**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          area: "杭州市",
          code: 1,
          condition: "晴间多云",
          temperature: 27.6,
          apparentTemperature: 29.1,
          humidity: 66,
          windDirection: 90,
          windSpeed: 8.2,
          observedAt: "2026-07-18T21:30",
        },
      }),
    });
  });

  await page.goto("/posts/");
  const weather = page.locator("[data-header-weather]");
  if ((page.viewportSize()?.width ?? 0) <= 1120) {
    await expect(weather).toBeHidden();
  } else {
    await expect(weather).toBeVisible();
    await expect(weather).toContainText("杭州市 · 28°");
    await expect(weather.locator("[data-header-weather-symbol]")).toHaveText("☁");
  }
});

test("selects and searches music from any page", async ({ page }, testInfo) => {
  const unique = `${Date.now()}${testInfo.retry}${testInfo.project.name.replace(/\D/g, "")}`.slice(0, 18);
  const title = `导航选曲-${unique}`;
  let trackId = "";

  await page.route("https://audio.example/**", async (route) => {
    await fulfillSilentAudio(route);
  });
  await page.route("**/api/music/covers**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: trackId ? { [trackId]: "/media/profile/avatar.jpg" } : {},
      }),
    });
  });

  try {
    await login(page);
    const create = await page.request.post("/api/admin/music/", {
      data: {
        title,
        artist: "远方测试歌手",
        neteaseSongId: unique,
        audioUrl: `https://audio.example/${unique}.wav`,
        note: "适合夜路关键词",
        enabled: true,
      },
    });
    expect(create.ok()).toBe(true);
    trackId = ((await create.json()) as { data: { id: string } }).data.id;

    await page.goto("/posts/");
    const player = page.locator("[data-header-music-player]");
    await player.locator("[data-header-music-trigger]").click();
    const search = player.locator("[data-header-music-search]");
    await search.fill("夜 路");
    const track = player.locator("[data-header-track]", { hasText: title });
    await expect(track).toBeVisible();

    await search.fill("完全不存在的歌");
    await expect(player.locator("[data-header-music-empty]")).toBeVisible();

    await search.fill("远方测试");
    await track.click();
    await expect(track).toHaveAttribute("aria-pressed", "true");
    await expect(player.locator("[data-header-music-title]")).toHaveText(title);
    await expect(player.locator("[data-site-audio]")).toHaveAttribute(
      "src",
      `https://audio.example/${unique}.wav`,
    );
    await expect(page).toHaveURL(/\/posts\/$/);
  } finally {
    if (trackId) await page.request.delete(`/api/admin/music/${trackId}/`);
  }
});

test("home and navbar controls share one persistent audio player", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(60_000);
  const unique = `${Date.now()}${testInfo.retry}${testInfo.project.name.replace(/\D/g, "")}`.slice(0, 18);
  const title = `此刻选曲-${unique}`;
  let trackId = "";
  const weatherRequests: string[] = [];

  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 31.1837, longitude: 121.4365 });
  await page.route("https://audio.example/**", async (route) => {
    await fulfillSilentAudio(route);
  });
  await page.route("**/api/music/covers**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: trackId ? { [trackId]: "/media/profile/avatar.jpg" } : {},
      }),
    });
  });
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
        audioUrl: `https://audio.example/${unique}.wav`,
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
    if (usesMobileDrawer(page)) {
      await expect(drawerToggle).toHaveAttribute("aria-expanded", "false");
      await drawerToggle.click();
    }
    await expect(page.locator("#weather-music iframe")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "访客天气" })).toBeVisible();
    await expect(page.getByRole("region", { name: "233昭的今日选曲" })).toBeVisible();
    await expect(page.locator("[data-now-time], [data-now-date], [data-now-greeting]")).toHaveCount(0);
    await expect(page.getByText("杭州", { exact: true })).toBeVisible();
    await expect.poll(() => weatherRequests.length).toBeGreaterThan(0);
    expect(weatherRequests.every((url) => !url.includes("lat=") && !url.includes("lon="))).toBe(true);
    await expect(page.locator("[data-site-audio]")).toHaveCount(1);
    const navbarPlayer = page.locator("[data-header-music-player]");
    await expect(navbarPlayer).toBeVisible();
    await expect(navbarPlayer.getByRole("button", { name: "打开音乐播放器" })).toBeVisible();

    const track = page.locator("#weather-music [data-track]", { hasText: title });
    await track.click();
    await expect(track).toHaveAttribute("aria-pressed", "true");
    await expect(navbarPlayer).toHaveAttribute("data-player-open", "false");
    const audio = navbarPlayer.locator("[data-site-audio]");
    await expect(audio).toHaveAttribute("src", `https://audio.example/${unique}.wav`);
    await audio.evaluate((element) => {
      element.setAttribute("data-persistence-probe", "same-node");
    });
    await track.click();
    await expect(audio).toHaveAttribute("data-persistence-probe", "same-node");

    const headerToggle = navbarPlayer.locator("[data-header-music-toggle]");
    const homeToggle = page.locator("[data-home-music-toggle]");
    await homeToggle.click();
    await expect(headerToggle).toHaveAttribute("aria-pressed", "true");
    await expect(homeToggle).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused))
      .toBe(false);

    await navbarPlayer.locator("[data-header-music-trigger]").click();
    await expect(navbarPlayer).toHaveAttribute("data-player-open", "true");
    await expect(headerToggle).toBeVisible();
    await headerToggle.click();
    await expect(headerToggle).toHaveAttribute("aria-pressed", "false");
    await expect(homeToggle).toHaveAttribute("aria-pressed", "false");

    await page.locator("[data-home-music-progress]").evaluate((element: HTMLInputElement) => {
      element.value = "500";
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(navbarPlayer.locator("[data-header-music-progress]")).toHaveValue("500");
    await page.locator("[data-home-music-volume]").evaluate((element: HTMLInputElement) => {
      element.value = "25";
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(navbarPlayer.locator("[data-header-music-volume]")).toHaveValue("25");
    await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.volume))
      .toBeCloseTo(0.25);

    const vinyl = page.locator("[data-music-vinyl]");
    await expect(vinyl).toHaveAttribute("data-has-cover", "true");
    await expect(vinyl.locator("[data-music-vinyl-cover]")).toHaveAttribute(
      "src",
      "/media/profile/avatar.jpg",
    );
    await expect.poll(() => vinyl.evaluate((element) => getComputedStyle(element).animationName))
      .toBe("now-spin");

    if (usesMobileDrawer(page)) {
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

    if (usesMobileDrawer(page)) {
      await homeToggle.evaluate((element: HTMLButtonElement) => element.click());
      await expect(headerToggle).toHaveAttribute("aria-pressed", "true");
      await homeToggle.evaluate((element: HTMLButtonElement) => element.click());
      await expect(headerToggle).toHaveAttribute("aria-pressed", "false");
    } else {
      await homeToggle.click();
      await page.getByRole("link", { name: "开始阅读" }).click();
      await expect(page).toHaveURL(/\/posts\/$/);
      await expect(navbarPlayer.locator("[data-site-audio]")).toHaveAttribute(
        "data-persistence-probe",
        "same-node",
      );
      await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused))
        .toBe(false);
      await expect(navbarPlayer.locator("[data-header-music-title]")).toHaveText(title);

      await page.getByRole("link", { name: "233昭 首页" }).click();
      await expect(page).toHaveURL(/\/$/);
      const returnedToggle = page.locator("[data-weather-music-toggle]");
      const expandedBeforeClick = await returnedToggle.getAttribute("aria-expanded");
      await returnedToggle.click();
      await expect(returnedToggle).toHaveAttribute(
        "aria-expanded",
        expandedBeforeClick === "true" ? "false" : "true",
      );
      await expect(navbarPlayer.locator("[data-site-audio]")).toHaveAttribute(
        "data-persistence-probe",
        "same-node",
      );
    }
  } finally {
    if (trackId && testInfo.status !== "timedOut") {
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
}) => {
  await page.goto("/");
  const toggle = page.locator("[data-weather-music-toggle]");
  const panel = page.locator("#hero-weather-music-panel");

  await expect(page.locator(".home-hero #weather-music")).toHaveCount(1);
  await expect(toggle).toHaveAttribute("aria-controls", "hero-weather-music-panel");

  if (usesMobileDrawer(page)) {
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toHaveAttribute("inert", "");
    const box = await toggle.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(panel).not.toHaveAttribute("inert", "");
    const heroCopyBox = await page.locator(".hero-copy").boundingBox();
    const drawerBox = await page.locator("#weather-music").boundingBox();
    expect(heroCopyBox).not.toBeNull();
    expect(drawerBox).not.toBeNull();
    expect(drawerBox!.y).toBeGreaterThanOrEqual(heroCopyBox!.y + heroCopyBox!.height - 1);
  } else {
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(panel).not.toHaveAttribute("inert", "");
    const scrollHint = page.locator(".hero-scroll");
    const toggleBox = await toggle.boundingBox();
    const scrollBox = await scrollHint.boundingBox();
    expect(toggleBox).not.toBeNull();
    expect(scrollBox).not.toBeNull();
    expect(toggleBox!.x + toggleBox!.width).toBeLessThan(scrollBox!.x);
  }

  await expect.poll(async () => ({
    toggle: await toggle.evaluate((element) => getComputedStyle(element).backgroundColor),
    panel: await panel.evaluate((element) => getComputedStyle(element).backgroundColor),
  })).toEqual({
    toggle: "rgba(0, 0, 0, 0)",
    panel: "rgba(0, 0, 0, 0)",
  });

  const musicHeading = page.locator(".now-music__heading h2");
  await expect.poll(async () => musicHeading.evaluate((element) => ({
    color: getComputedStyle(element).color,
    textShadow: getComputedStyle(element).textShadow,
  }))).toEqual({
    color: "rgb(11, 72, 83)",
    textShadow: "rgb(255, 255, 255) 0px 1px 0px, rgba(255, 255, 255, 0.9) 0px 0px 12px",
  });
});

test("stored Hero drawer preference overrides the desktop default", async ({
  page,
}) => {
  test.skip(usesMobileDrawer(page), "Desktop default coverage only.");
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

test("mobile IP weather refreshes only while the Hero drawer is open and visible", async ({
  page,
}) => {
  test.skip(!usesMobileDrawer(page), "Mobile closed-default lifecycle coverage.");
  await page.clock.install({ time: new Date("2026-07-18T10:00:00+08:00") });
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
  expect(requests[0]).not.toContain("lat=");
  expect(requests[0]).not.toContain("lon=");

  await page.clock.fastForward(600_000);
  await expect.poll(() => requests.length).toBe(2);

  await toggle.click();
  const closedRequestCount = requests.length;
  await page.clock.fastForward(600_000);
  expect(requests).toHaveLength(closedRequestCount);

  await toggle.click();
  await expect.poll(() => requests.length).toBe(closedRequestCount + 1);
});

test("manual address refresh requests fresh device coordinates", async ({
  page,
  context,
}) => {
  const requests: string[] = [];
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({ latitude: 31.1837, longitude: 121.4365 });
  await page.route("**/api/weather**", async (route) => {
    requests.push(route.request().url());
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          area: requests.length === 1 ? "首次 IP 地址" : "设备定位地址",
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
  if (usesMobileDrawer(page)) {
    await page.locator("[data-weather-music-toggle]").click();
  }
  await expect(page.locator("[data-weather-area]")).toHaveText("首次 IP 地址");

  const refreshLocation = page.getByRole("button", { name: "重新获取地址" });
  await expect(refreshLocation).toBeVisible();
  await refreshLocation.click();

  await expect(page.locator("[data-weather-area]")).toHaveText("设备定位地址");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toContain("refresh=1");
  expect(requests[1]).toContain("lat=31.1837");
  expect(requests[1]).toContain("lon=121.4365");
});

test("weather refresh failure preserves the last successful snapshot", async ({
  page,
}) => {
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
  if (usesMobileDrawer(page)) {
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
