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
const geolocationSessionKey = "home-weather-geolocation-attempted";

if (section) {
  const toggle = section.querySelector<HTMLButtonElement>("[data-weather-music-toggle]");
  const panel = section.querySelector<HTMLElement>("[data-weather-music-panel]");
  const drawerStorageKey = "hero-weather-music-open";
  const mobileQuery = window.matchMedia("(max-width: 899px)");

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
  };

  setDrawerOpen(storedDrawerState() ?? !mobileQuery.matches, false);
  toggle?.addEventListener("click", () => {
    setDrawerOpen(section.dataset.drawerOpen !== "true");
  });

  const weatherPanel = section.querySelector<HTMLElement>("[data-weather-panel]");
  const notesElement = section.querySelector<HTMLScriptElement>("[data-weather-notes]");
  const notes = JSON.parse(notesElement?.textContent ?? "{}") as WeatherNotes;
  let weatherRequest = 0;

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
    weatherPanel?.setAttribute("aria-busy", "false");
  };

  const loadWeather = async (endpoint: string) => {
    const requestId = ++weatherRequest;
    try {
      const response = await fetch(endpoint, { headers: { accept: "application/json" } });
      const result = await response.json() as { data?: WeatherSnapshot; error?: string };
      if (!response.ok || !result.data) throw new Error(result.error ?? "天气读取失败。");
      if (requestId === weatherRequest) showWeather(result.data);
    } catch {
      if (requestId !== weatherRequest) return;
      setText("[data-weather-condition]", "天气暂时藏进云里了");
      setText("[data-weather-note]", notes.fallback ?? "天气暂时藏进云里了。");
      weatherPanel?.setAttribute("aria-busy", "false");
    }
  };

  const endpoint = section.dataset.weatherEndpoint ?? "/api/weather/";
  void loadWeather(endpoint);

  const requestPreciseWeather = async () => {
    if (!navigator.geolocation || sessionStorage.getItem(geolocationSessionKey)) return;
    if (navigator.permissions) {
      try {
        const permission = await navigator.permissions.query({ name: "geolocation" });
        if (permission.state === "denied") return;
      } catch {
        // Browsers without a geolocation permission descriptor continue with one normal request.
      }
    }
    sessionStorage.setItem(geolocationSessionKey, "1");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const url = new URL(endpoint, window.location.origin);
        url.searchParams.set("lat", String(coords.latitude));
        url.searchParams.set("lon", String(coords.longitude));
        void loadWeather(`${url.pathname}${url.search}`);
      },
      () => undefined,
      { enableHighAccuracy: false, timeout: 5_000, maximumAge: 10 * 60 * 1000 },
    );
  };
  void requestPreciseWeather();

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
