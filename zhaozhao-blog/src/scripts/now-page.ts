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

const page = document.querySelector<HTMLElement>("[data-now-page]");

if (page) {
  const time = page.querySelector<HTMLTimeElement>("[data-now-time]")!;
  const date = page.querySelector<HTMLElement>("[data-now-date]")!;
  const greeting = page.querySelector<HTMLElement>("[data-now-greeting]")!;

  const dayPart = (hour: number) => {
    if (hour >= 5 && hour < 9) return "dawn";
    if (hour >= 9 && hour < 17) return "day";
    if (hour >= 17 && hour < 20) return "dusk";
    return "night";
  };

  const greetingFor = (hour: number) => {
    if (hour >= 5 && hour < 11) return "早上好，愿今天从一阵轻柔的海风开始。";
    if (hour >= 11 && hour < 14) return "中午好，暂时把忙碌放在窗外。";
    if (hour >= 14 && hour < 18) return "下午好，光正在海面上慢慢移动。";
    if (hour >= 18 && hour < 23) return "晚上好，选一首歌陪晚霞退场。";
    return "夜深了，让旋律替海面留一盏灯。";
  };

  const updateClock = () => {
    const now = new Date();
    time.dateTime = now.toISOString();
    time.textContent = new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(now);
    date.textContent = new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "long",
    }).format(now);
    greeting.textContent = greetingFor(now.getHours());
    document.documentElement.dataset.dayPart = dayPart(now.getHours());
  };

  updateClock();
  const minuteTimer = window.setInterval(updateClock, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") updateClock();
  });
  window.addEventListener("pagehide", () => window.clearInterval(minuteTimer), { once: true });

  const weatherPanel = page.querySelector<HTMLElement>("[data-weather-panel]");
  const notesElement = page.querySelector<HTMLScriptElement>("[data-weather-notes]");
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
    const element = page.querySelector<HTMLElement>(selector);
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

  const endpoint = page.dataset.weatherEndpoint ?? "/api/weather";
  void loadWeather(endpoint);

  const requestPreciseWeather = async () => {
    if (!navigator.geolocation || sessionStorage.getItem("now-geolocation-attempted")) return;
    if (navigator.permissions) {
      try {
        const permission = await navigator.permissions.query({ name: "geolocation" });
        if (permission.state === "denied") return;
      } catch {
        // Browsers without a geolocation permission descriptor continue with one normal request.
      }
    }
    sessionStorage.setItem("now-geolocation-attempted", "1");
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

  const player = page.querySelector<HTMLElement>("[data-music-player]");
  if (player) {
    const frame = player.querySelector<HTMLElement>("[data-player-frame]");
    const vinyl = player.querySelector<HTMLElement>("[data-now-vinyl]");
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
