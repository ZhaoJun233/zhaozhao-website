import type {
  MusicPlaybackCommand,
  MusicPlaybackState,
  MusicSelection,
} from "./music-events";

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

let cleanupActiveSection: (() => void) | undefined;

function selectedTrackFromHeader(): MusicSelection | undefined {
  const root = document.querySelector<HTMLElement>("[data-header-music-player][data-track-id]");
  const {
    trackId,
    trackTitle,
    trackArtist,
    trackCover,
    trackAudio,
    trackEmbed,
    trackUrl,
  } = root?.dataset ?? {};
  if (!trackId || !trackTitle || !trackEmbed || !trackUrl) return undefined;
  return {
    id: trackId,
    title: trackTitle,
    artist: trackArtist ?? "",
    embedUrl: trackEmbed,
    neteaseUrl: trackUrl,
    ...(trackCover ? { coverUrl: trackCover } : {}),
    ...(trackAudio ? { audioUrl: trackAudio } : {}),
  };
}

function initializeHomeWeatherMusic(): void {
  const section = document.querySelector<HTMLElement>("[data-home-weather-music]");
  if (!section || section.dataset.weatherMusicReady === "true") return;
  cleanupActiveSection?.();
  section.dataset.weatherMusicReady = "true";

  const toggle = section.querySelector<HTMLButtonElement>("[data-weather-music-toggle]");
  const panel = section.querySelector<HTMLElement>("[data-weather-music-panel]");
  const weatherPanel = section.querySelector<HTMLElement>("[data-weather-panel]");
  const locationRefresh = section.querySelector<HTMLButtonElement>("[data-weather-location-refresh]");
  const notesElement = section.querySelector<HTMLScriptElement>("[data-weather-notes]");
  const notes = JSON.parse(notesElement?.textContent ?? "{}") as WeatherNotes;
  const endpoint = section.dataset.weatherEndpoint ?? "/api/weather/";
  const coverEndpoint = section.dataset.coverEndpoint ?? "/api/music/covers/";
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
    } catch {
      if (controller.signal.aborted || generation !== refreshGeneration || !drawerIsOpen() || document.hidden) return false;
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
      const loaded = await loadWeather(`${weatherEndpoint.pathname}${weatherEndpoint.search}`, generation);
      if (loaded && fallbackMessage) setText("[data-weather-refresh-status]", fallbackMessage);
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
    refreshTimer = window.setInterval(() => void refreshWeather(), weatherRefreshMs);
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
      } catch {}
    }
    if (open) {
      void refreshWeather();
      startWeatherRefresh();
    } else {
      stopWeatherRefresh();
    }
  };

  const applyMusicSelection = (track: MusicSelection | undefined) => {
    const player = section.querySelector<HTMLElement>("[data-music-player]");
    if (!player) return;
    for (const item of player.querySelectorAll<HTMLButtonElement>("[data-track]")) {
      item.setAttribute("aria-pressed", String(item.dataset.trackId === track?.id));
    }
    const vinyl = player.querySelector<HTMLElement>("[data-music-vinyl]");
    const vinylCover = player.querySelector<HTMLImageElement>("[data-music-vinyl-cover]");
    const currentTitle = player.querySelector<HTMLElement>("[data-current-track]");
    const currentArtist = player.querySelector<HTMLElement>("[data-current-artist]");
    const currentLink = player.querySelector<HTMLAnchorElement>("[data-current-link]");
    if (track) {
      if (currentTitle) currentTitle.textContent = track.title;
      if (currentArtist) currentArtist.textContent = `${track.artist} · 首页与导航同步控制`;
      if (currentLink) currentLink.href = track.neteaseUrl;
      vinyl?.setAttribute("data-selected", "true");
      if (track.coverUrl && vinylCover) {
        vinylCover.src = track.coverUrl;
        vinylCover.hidden = false;
        vinyl?.setAttribute("data-has-cover", "true");
      } else {
        vinylCover?.removeAttribute("src");
        if (vinylCover) vinylCover.hidden = true;
        vinyl?.removeAttribute("data-has-cover");
      }
    }
  };

  const showTrackCover = (button: HTMLButtonElement, coverUrl: string) => {
    button.dataset.trackCover = coverUrl;
    const cover = button.querySelector<HTMLElement>(".now-track-list__cover");
    if (!cover) return;
    const image = document.createElement("img");
    image.src = coverUrl;
    image.alt = "";
    image.loading = "lazy";
    cover.replaceChildren(image);
  };

  const loadTrackCovers = async () => {
    try {
      const response = await fetch(coverEndpoint, {
        headers: { accept: "application/json" },
      });
      const result = await response.json() as { data?: Record<string, string> };
      if (!response.ok || !result.data) throw new Error("专辑封面读取失败");
      for (const button of section.querySelectorAll<HTMLButtonElement>("[data-track]")) {
        const coverUrl = button.dataset.trackId ? result.data[button.dataset.trackId] : undefined;
        if (coverUrl?.trim()) showTrackCover(button, coverUrl);
      }
      const selected = selectedTrackFromHeader();
      const selectedCover = selected ? result.data[selected.id] : undefined;
      if (selected && selectedCover?.trim()) applyMusicSelection({ ...selected, coverUrl: selectedCover });
    } catch {
      // Keep the music list usable when automatic cover lookup is unavailable.
    }
  };

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const rounded = Math.floor(seconds);
    return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
  };

  const applyPlaybackState = (state: MusicPlaybackState) => {
    const toggle = section.querySelector<HTMLButtonElement>("[data-home-music-toggle]");
    const icon = section.querySelector<HTMLElement>("[data-home-music-toggle-icon]");
    const status = section.querySelector<HTMLElement>("[data-home-music-status]");
    const progress = section.querySelector<HTMLInputElement>("[data-home-music-progress]");
    const volume = section.querySelector<HTMLInputElement>("[data-home-music-volume]");
    const current = section.querySelector<HTMLElement>("[data-home-music-current]");
    const duration = section.querySelector<HTMLElement>("[data-home-music-duration]");
    const vinyl = section.querySelector<HTMLElement>("[data-music-vinyl]");
    const progressValue = state.duration > 0
      ? Math.round((state.currentTime / state.duration) * 1000)
      : 0;
    if (state.track) applyMusicSelection(state.track);
    if (toggle) {
      toggle.disabled = !state.canPlay;
      toggle.setAttribute("aria-pressed", String(state.playing));
      toggle.setAttribute("aria-label", state.playing ? "暂停音乐" : "播放音乐");
    }
    if (icon) icon.textContent = state.playing ? "❚❚" : "▶";
    if (status) {
      status.textContent = state.error
        ?? (!state.track
          ? "从唱片架选择一首歌"
          : !state.canPlay
            ? "这首歌尚未配置音频地址"
            : state.playing ? "正在播放" : "已暂停");
    }
    if (progress) {
      progress.disabled = !state.canPlay || state.duration <= 0;
      progress.value = String(progressValue);
    }
    if (volume) volume.value = String(Math.round(state.volume * 100));
    if (current) current.textContent = formatTime(state.currentTime);
    if (duration) duration.textContent = formatTime(state.duration);
    vinyl?.toggleAttribute("data-playing", state.playing);
  };

  const sendPlaybackCommand = (command: MusicPlaybackCommand) => {
    document.dispatchEvent(new CustomEvent<MusicPlaybackCommand>("site:music-command", {
      detail: command,
    }));
  };

  const handleToggle = () => setDrawerOpen(!drawerIsOpen());
  const handleLocationRefresh = () => void refreshWeather(true);
  const handleVisibility = () => {
    if (document.hidden) {
      stopWeatherRefresh();
      return;
    }
    if (!drawerIsOpen()) return;
    if (!lastWeatherSuccess || Date.now() - lastWeatherSuccess >= weatherRefreshMs) void refreshWeather();
    startWeatherRefresh();
  };
  const handleMusicClick = (event: Event) => {
    if ((event.target as HTMLElement).closest("[data-home-music-toggle]")) {
      sendPlaybackCommand({ action: "toggle" });
      return;
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-track]");
    if (!button?.dataset.neteaseEmbed || !button.dataset.trackId) return;
    const track: MusicSelection = {
      id: button.dataset.trackId,
      title: button.dataset.trackTitle ?? "当前选曲",
      artist: button.dataset.trackArtist ?? "",
      embedUrl: button.dataset.neteaseEmbed,
      neteaseUrl: button.dataset.neteaseUrl ?? "https://music.163.com/",
      ...(button.dataset.trackCover ? { coverUrl: button.dataset.trackCover } : {}),
      ...(button.dataset.audioUrl ? { audioUrl: button.dataset.audioUrl } : {}),
    };
    applyMusicSelection(track);
    document.dispatchEvent(new CustomEvent<MusicSelection>("site:music-select", { detail: track }));
  };
  const handleMusicChange = (event: CustomEvent<MusicSelection>) => applyMusicSelection(event.detail);
  const handleMusicState = (event: CustomEvent<MusicPlaybackState>) => applyPlaybackState(event.detail);
  const handleProgressInput = (event: Event) => sendPlaybackCommand({
    action: "seek",
    value: Number((event.currentTarget as HTMLInputElement).value),
  });
  const handleVolumeInput = (event: Event) => sendPlaybackCommand({
    action: "volume",
    value: Number((event.currentTarget as HTMLInputElement).value),
  });

  toggle?.addEventListener("click", handleToggle);
  locationRefresh?.addEventListener("click", handleLocationRefresh);
  section.addEventListener("click", handleMusicClick);
  section.querySelector<HTMLInputElement>("[data-home-music-progress]")
    ?.addEventListener("input", handleProgressInput);
  section.querySelector<HTMLInputElement>("[data-home-music-volume]")
    ?.addEventListener("input", handleVolumeInput);
  document.addEventListener("visibilitychange", handleVisibility);
  document.addEventListener("site:music-change", handleMusicChange);
  document.addEventListener("site:music-state", handleMusicState);

  applyMusicSelection(selectedTrackFromHeader());
  void loadTrackCovers();
  document.dispatchEvent(new CustomEvent("site:music-state-request"));
  setDrawerOpen(storedDrawerState() ?? !mobileQuery.matches, false);

  cleanupActiveSection = () => {
    stopWeatherRefresh();
    toggle?.removeEventListener("click", handleToggle);
    locationRefresh?.removeEventListener("click", handleLocationRefresh);
    section.removeEventListener("click", handleMusicClick);
    section.querySelector<HTMLInputElement>("[data-home-music-progress]")
      ?.removeEventListener("input", handleProgressInput);
    section.querySelector<HTMLInputElement>("[data-home-music-volume]")
      ?.removeEventListener("input", handleVolumeInput);
    document.removeEventListener("visibilitychange", handleVisibility);
    document.removeEventListener("site:music-change", handleMusicChange);
    document.removeEventListener("site:music-state", handleMusicState);
    delete section.dataset.weatherMusicReady;
    cleanupActiveSection = undefined;
  };
}

initializeHomeWeatherMusic();
document.addEventListener("astro:page-load", initializeHomeWeatherMusic);
document.addEventListener("astro:before-swap", () => cleanupActiveSection?.());

export {};
