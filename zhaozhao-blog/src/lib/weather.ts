import { z } from "astro/zod";

export interface WeatherSnapshot {
  area: string;
  code: number;
  condition: string;
  temperature: number;
  apparentTemperature: number;
  humidity: number;
  windDirection: number;
  windSpeed: number;
  observedAt: string;
}

export interface WeatherFetchInput {
  latitude: number;
  longitude: number;
  area?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

export interface ReverseGeocodeInput {
  latitude: number;
  longitude: number;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

const upstreamSchema = z.object({
  current: z.object({
    time: z.string().min(1),
    temperature_2m: z.number(),
    apparent_temperature: z.number(),
    relative_humidity_2m: z.number(),
    weather_code: z.number().int().min(0).max(99),
    wind_speed_10m: z.number().nonnegative(),
    wind_direction_10m: z.number(),
  }),
});

const reverseGeocodeSchema = z.object({
  locality: z.string().trim().max(120).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  principalSubdivision: z.string().trim().max(120).optional().nullable(),
});

export class WeatherCoordinateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeatherCoordinateError";
  }
}

function coordinate(value: unknown, label: "纬度" | "经度"): number {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new WeatherCoordinateError(`${label}必须是有效数字。`);
  }
  if (typeof value === "string" && value.trim() === "") {
    throw new WeatherCoordinateError(`${label}必须是有效数字。`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new WeatherCoordinateError(`${label}必须是有效数字。`);
  return parsed;
}

export function normalizeCoordinates(
  lat: unknown,
  lon: unknown,
): { latitude: number; longitude: number } {
  const latitude = coordinate(lat, "纬度");
  const longitude = coordinate(lon, "经度");
  if (latitude < -90 || latitude > 90) {
    throw new WeatherCoordinateError("纬度必须在 -90 到 90 之间。");
  }
  if (longitude < -180 || longitude > 180) {
    throw new WeatherCoordinateError("经度必须在 -180 到 180 之间。");
  }
  return { latitude, longitude };
}

export function weatherCacheKey(latitude: number, longitude: number): string {
  const normalized = normalizeCoordinates(latitude, longitude);
  return `weather:${normalized.latitude.toFixed(2)}:${normalized.longitude.toFixed(2)}`;
}

export function reverseGeocodeCacheKey(latitude: number, longitude: number): string {
  const coordinates = normalizeCoordinates(latitude, longitude);
  return `reverse:${Math.round(coordinates.latitude / 0.02)}:${Math.round(coordinates.longitude / 0.02)}`;
}

export function weatherCondition(code: number): string {
  if (code === 0) return "晴";
  if ([1, 2, 3].includes(code)) return "多云";
  if ([45, 48].includes(code)) return "雾";
  if ([51, 53, 55, 56, 57].includes(code)) return "细雨";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "雨";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "雪";
  if ([95, 96, 99].includes(code)) return "雷雨";
  return "天气变化中";
}

export async function fetchReverseGeocode({
  latitude,
  longitude,
  fetcher = fetch,
  timeoutMs = 5_000,
}: ReverseGeocodeInput): Promise<string> {
  normalizeCoordinates(latitude, longitude);
  const url = new URL("https://api.bigdatacloud.net/data/reverse-geocode-client");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("localityLanguage", "zh");

  const response = await fetcher(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`BigDataCloud returned ${response.status}.`);
  const value = reverseGeocodeSchema.parse(await response.json());
  const locality = value.locality?.trim();
  const city = value.city?.trim();
  if (locality && city && locality !== city) return `${locality} · ${city}`;
  return locality || city || value.principalSubdivision?.trim() || "当前位置";
}

export async function fetchWeatherSnapshot({
  latitude,
  longitude,
  area = "访客所在区域",
  fetcher = fetch,
  timeoutMs = 5_000,
}: WeatherFetchInput): Promise<WeatherSnapshot> {
  normalizeCoordinates(latitude, longitude);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m",
  );
  url.searchParams.set("timezone", "auto");

  const response = await fetcher(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Open-Meteo returned ${response.status}.`);
  const { current } = upstreamSchema.parse(await response.json());
  return {
    area: area.trim() || "访客所在区域",
    code: current.weather_code,
    condition: weatherCondition(current.weather_code),
    temperature: current.temperature_2m,
    apparentTemperature: current.apparent_temperature,
    humidity: current.relative_humidity_2m,
    windDirection: current.wind_direction_10m,
    windSpeed: current.wind_speed_10m,
    observedAt: current.time,
  };
}
