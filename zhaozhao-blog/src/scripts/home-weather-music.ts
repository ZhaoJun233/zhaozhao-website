type WeatherSnapshot = {
  area: string;
  code: number;
  condition: string;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windDirection: number;
  windSpeed: number;
  observedAt: string;
};

type WeatherNotes = Record<"clear" | "cloudy" | "rain" | "snow" | "storm" | "fallback", string>;

const section = document.querySelector<HTMLElement>("[data-home-weather-music]");

if (section) {
  const toggle = section.querySelector<HTMLButtonElement>("[data-weather-music-toggle]");
  const panel = section.querySelector<HTMLElement>("[data-weather-music-panel]");
  const weatherPanel = section.querySelector<HTMLElement>("[data-weather-panel]");
  const locationRefresh = section.querySelector<HTMLButtonElement>("[data-weather-location-refresh]");
  const notesElement = section.querySelector<HTMLScriptElement>("[data-weather-notes]");
  const notes = JSON.parse(notesElement?.textContent ?? "{}") as WeatherNotes;
  const endpoint = section.dataset.weatherEndpoint ?? "/api/weather/";
  const drawerStorageKey = "hero-weather-music-open";
  const mobileQuery = window.matchMedia("(max-width: 899px)");
  const weatherRefreshMs = 10 * 60 * 1000;
  let refreshTimer: number | undefined;
  let lastWeatherSuccess = 0;
  let hasWeatherSnapshot = false;
  let refreshGeneration = 0;
  let activeWeatherAbort: AbortController | undefined;

  const drawerIsOpen = () => section.dataset.drawerOpen === "true";

  const noteKey = (code: number): keyof WeatherNotes => {
    if ([95, 96, 99].includes(code)) return "storm";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rain";
    if ([1, 2, 3, 45, 48].includes(code)) return "cloudy";
    return "clear";
  };

  const symbolFor = (code: number) => {
    if ([95, 96, 99].includes(code)) return "ϟ";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "❄";
    if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "☂";
    if ([1, 2, 3, 45, 48].includes(code)) return "☁";
    return "☼";
  };

  const setText = (selector: string, value: string) => {
    const element = section.querySelector<HTMLElement>(selector);
    if (element) element.textContent = value;
  };

  const showWeather = (snapshot: WeatherSnapshot) => {
    setText("[data-weather-area]", snapshot.area);
    setText("[data-weather-symbol]", symbolFor(snapshot.code));
    setText("[data-weather-temperature]", `${Math.round(snapshot.temperature)}°`);
    setText("[data-weather-condition]", snapshot.condition);
    setText("[data-weather-observed]", `观测于 ${snapshot.observedAt.replace("T", " ")}`);
    setText("[data-weather-apparent]", `${Math.round(snapshot.apparentTemperature)}°`);
    setText("[data-weather-humidity]", `${Math.round(snapshot.humidity)}%`);
    setText("[data-weather-wind]", `${Math.round(snapshot.windSpeed)} km/h`);
    setText("[data-weather-note]", notes[noteKey(snapshot.code)] ?? notes.fallback);
    setText("[data-weather-refresh-status]", "");
    hasWeatherSnapshot = true;
    lastWeatherSuccess = Date.now();
    weatherPanel?.setAttribute("aria-busy", "false");
  };

  const showWeatherFailure = () => {
    if (hasWeatherSnapshot) {
      setText("[data-weather-refresh-status]", "更新暂时失败");
    } else {
      setText("[data-weather-condition]", "天气暂时藏进云里了");
      setText("[data-weather-note]", notes.fallback ?? "天气暂时藏进云里了。");
    }
    weatherPanel?.setAttribute("aria-busy", "false");
  };

  const loadWeather = async (weatherEndpoint: string, generation: number) => {
    activeWeatherAbort?.abort();
    const controller = new AbortController();
    activeWeatherAbort = controller;
    try {
      const response = await fetch(weatherEndpoint, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      const result = await response.json() as { data?: WeatherSnapshot; error?: string };
      if (!response.ok || !result.data) throw new Error(result.error ?? "天气读取失败。");
      if (generation === refreshGeneration && drawerIsOpen() && !document.hidden) {
        showWeather(result.data);
        return true;
      }
      return false;
    } catch (error) {
      if (
        controller.signal.aborted
        || generation !== refreshGeneration
        || !drawerIsOpen()
        || document.hidden
      ) return false;
      showWeatherFailure();
      return false;
    } finally {
      if (activeWeatherAbort === controller) activeWeatherAbort = undefined;
    }
  };

  const currentPosition = () => new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 0,
    });
  });

  const refreshWeather = async (requestDeviceLocation = false) => {
    if (!drawerIsOpen() || document.hidden) return;
    const generation = ++refreshGeneration;
    if (!hasWeatherSnapshot) weatherPanel?.setAttribute("aria-busy", "true");
    const weatherEndpoint = new URL(endpoint, window.location.origin);
    let fallbackMessage = "";
    locationRefresh?.toggleAttribute("disabled", requestDeviceLocation);
    try {
      if (requestDeviceLocation) {
        weatherEndpoint.searchParams.set("refresh", "1");
        setText("[data-weather-refresh-status]", "正在获取设备位置…");
        if (navigator.geolocation) {
          try {
            const { coords } = await currentPosition();
            if (generation !== refreshGeneration || !drawerIsOpen() || document.hidden) return;
            weatherEndpoint.searchParams.set("lat", String(coords.latitude));
            weatherEndpoint.searchParams.set("lon", String(coords.longitude));
          } catch {
            fallbackMessage = "未获得设备位置，已按 IP 更新";
          }
        } else {
          fallbackMessage = "浏览器不支持设备定位，已按 IP 更新";
        }
      }
      const loaded = await loadWeather(
        `${weatherEndpoint.pathname}${weatherEndpoint.search}`,
        generation,
      );
      if (loaded && fallbackMessage) {
        setText("[data-weather-refresh-status]", fallbackMessage);
      }
    } finally {
      if (requestDeviceLocation) locationRefresh?.removeAttribute("disabled");
    }
  };

  const stopWeatherRefresh = () => {
    if (refreshTimer !== undefined) {
      window.clearInterval(refreshTimer);
      refreshTimer = undefined;
    }
    refreshGeneration += 1;
    activeWeatherAbort?.abort();
    activeWeatherAbort = undefined;
    weatherPanel?.setAttribute("aria-busy", "false");
  };

  const startWeatherRefresh = () => {
    if (refreshTimer !== undefined) window.clearInterval(refreshTimer);
    refreshTimer = undefined;
    if (!drawerIsOpen() || document.hidden) return;
    refreshTimer = window.setInterval(() => {
      void refreshWeather();
    }, weatherRefreshMs);
  };

  const storedDrawerState = (): boolean | undefined => {
    try {
      const value = localStorage.getItem(drawerStorageKey);
      return value === "true" ? true : value === "false" ? false : undefined;
    } catch {
      return undefined;
    }
  };

  const setDrawerOpen = (open: boolean, persist = true) => {
    section.dataset.drawerOpen = String(open);
    toggle?.setAttribute("aria-expanded", String(open));
    if (toggle) toggle.textContent = open ? "隐藏天气音乐" : "天气 · 音乐";
    panel?.toggleAttribute("inert", !open);
    if (persist) {
      try {
        localStorage.setItem(drawerStorageKey, String(open));
      } catch {
        // Storage may be unavailable in private browsing; the drawer still works for this page.
      }
    }
    if (open) {
      void refreshWeather();
      startWeatherRefresh();
    } else {
      stopWeatherRefresh();
    }
  };

  setDrawerOpen(storedDrawerState() ?? !mobileQuery.matches, false);
  toggle?.addEventListener("click", () => {
    setDrawerOpen(!drawerIsOpen());
  });
  locationRefresh?.addEventListener("click", () => {
    void refreshWeather(true);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopWeatherRefresh();
      return;
    }
    if (!drawerIsOpen()) return;
    if (!lastWeatherSuccess || Date.now() - lastWeatherSuccess >= weatherRefreshMs) {
      void refreshWeather();
    }
    startWeatherRefresh();
  });

  const player = section.querySelector<HTMLElement>("[data-music-player]");
  if (player) {
    const frame = player.querySelector<HTMLElement>("[data-player-frame]");
    const vinyl = player.querySelector<HTMLElement>("[data-music-vinyl]");
    const currentTitle = player.querySelector<HTMLElement>("[data-current-track]");
    const currentArtist = player.querySelector<HTMLElement>("[data-current-artist]");
    const currentLink = player.querySelector<HTMLAnchorElement>("[data-current-link]");

    player.addEventListener("click", (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-track]");
      if (!button?.dataset.neteaseEmbed) return;
      for (const item of player.querySelectorAll<HTMLButtonElement>("[data-track]")) {
        item.setAttribute("aria-pressed", String(item === button));
      }
      if (currentTitle) currentTitle.textContent = button.dataset.trackTitle ?? "当前选曲";
      if (currentArtist) currentArtist.textContent = button.dataset.trackArtist ?? "";
      if (currentLink) currentLink.href = button.dataset.neteaseUrl ?? "https://music.163.com/";
      vinyl?.setAttribute("data-selected", "true");
      if (!frame) return;
      const iframe = document.createElement("iframe");
      iframe.src = button.dataset.neteaseEmbed;
      iframe.title = `网易云音乐播放器：${button.dataset.trackTitle ?? "当前选曲"}`;
      iframe.loading = "lazy";
      iframe.allow = "autoplay; encrypted-media";
      frame.replaceChildren(iframe);
    });
  }
}

export {};
