import { compactWeatherSymbol, compactWeatherText } from "../lib/header-widgets";

interface CompactWeatherSnapshot {
  area: string;
  code: number;
  temperature: number;
}

function initializeHeaderWeather(): void {
  const root = document.querySelector<HTMLButtonElement>("[data-header-weather]");
  if (!root || root.dataset.weatherReady === "true") return;
  root.dataset.weatherReady = "true";

  const symbol = root.querySelector<HTMLElement>("[data-header-weather-symbol]");
  const text = root.querySelector<HTMLElement>("[data-header-weather-text]");
  const endpoint = root.dataset.weatherEndpoint ?? "/api/weather/";
  const refreshMs = 10 * 60 * 1000;
  let hasSnapshot = false;
  let loading = false;

  const loadWeather = async () => {
    if (loading || document.hidden) return;
    loading = true;
    root.setAttribute("aria-busy", "true");
    try {
      const response = await fetch(endpoint, {
        cache: "no-store",
        headers: { accept: "application/json" },
      });
      const result = await response.json() as { data?: CompactWeatherSnapshot };
      if (!response.ok || !result.data) throw new Error("天气读取失败");
      const label = compactWeatherText(result.data.area, result.data.temperature);
      if (symbol) symbol.textContent = compactWeatherSymbol(result.data.code);
      if (text) text.textContent = label;
      root.setAttribute("aria-label", `当前天气：${label}；点击刷新`);
      hasSnapshot = true;
    } catch {
      if (!hasSnapshot && text) text.textContent = "天气暂不可用";
    } finally {
      loading = false;
      root.removeAttribute("aria-busy");
    }
  };

  root.addEventListener("click", () => void loadWeather());
  window.setInterval(() => void loadWeather(), refreshMs);
  void loadWeather();
}

initializeHeaderWeather();
document.addEventListener("astro:page-load", initializeHeaderWeather);

export {};
