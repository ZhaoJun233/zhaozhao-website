import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  fetchAmapIpLocation,
  fetchAmapReverseGeocode,
  fetchReverseGeocode,
  fetchWeatherSnapshot,
  normalizeCoordinates,
  reverseGeocodeCacheKey,
  WeatherCoordinateError,
  weatherCacheKey,
} from "../../lib/weather";

interface WeatherCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

interface WeatherRouteDependencies {
  fetcher?: typeof fetch;
  cache?: WeatherCache;
  amapKey?: string;
}

interface CloudflareLocation {
  latitude?: string | number;
  longitude?: string | number;
  city?: string;
}

const fallbackCoordinates = { latitude: 30.2741, longitude: 120.1551 };
const responseHeaders = { "cache-control": "public, max-age=600" };
const refreshResponseHeaders = { "cache-control": "no-store" };
const reverseResponseHeaders = { "cache-control": "public, max-age=3600" };
const ipLocationResponseHeaders = { "cache-control": "public, max-age=21600" };

type LocationSource = "precise" | "amap-ip" | "cloudflare" | "fallback";

function requestLocation(request: Request): CloudflareLocation {
  return ((request as Request & { cf?: CloudflareLocation }).cf ?? {});
}

function cacheRequest(latitude: number, longitude: number, source: LocationSource): Request {
  const key = weatherCacheKey(latitude, longitude).replaceAll(":", "/");
  return new Request(`https://weather-cache.internal/${source}/${key}`);
}

function reverseCacheRequest(
  latitude: number,
  longitude: number,
  provider: "amap" | "bigdatacloud",
): Request {
  const key = reverseGeocodeCacheKey(latitude, longitude).replaceAll(":", "/");
  return new Request(`https://reverse-geocode-cache.internal/${provider}-v1/${key}`);
}

function weatherCache(): WeatherCache {
  return (caches as CacheStorage & { default: Cache }).default as unknown as WeatherCache;
}

function runtimeAmapKey(): string | undefined {
  const value = (env as Cloudflare.Env & { AMAP_WEB_SERVICE_KEY?: string })
    .AMAP_WEB_SERVICE_KEY?.trim();
  return value || undefined;
}

async function hashedIpCacheRequest(ip: string): Promise<Request> {
  const bytes = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return new Request(`https://ip-location-cache.internal/amap-v1/${hash}`);
}

function routeCoordinates(request: Request): {
  latitude: number;
  longitude: number;
  area: string;
  source: LocationSource;
} {
  const url = new URL(request.url);
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");
  const cf = requestLocation(request);
  if ((lat === null) !== (lon === null)) {
    throw new WeatherCoordinateError("纬度和经度必须同时提供。");
  }
  if (lat !== null && lon !== null) {
    return { ...normalizeCoordinates(lat, lon), area: "当前位置", source: "precise" };
  }
  if (cf.latitude !== undefined && cf.longitude !== undefined) {
    return {
      ...normalizeCoordinates(cf.latitude, cf.longitude),
      area: typeof cf.city === "string" && cf.city.trim() ? cf.city.trim() : "访客所在区域",
      source: "cloudflare",
    };
  }
  return { ...fallbackCoordinates, area: "访客所在区域", source: "fallback" };
}

async function resolveAmapIpLocation(
  request: Request,
  fallback: ReturnType<typeof routeCoordinates>,
  amapKey: string | undefined,
  cache: WeatherCache,
  fetcher: typeof fetch,
): Promise<ReturnType<typeof routeCoordinates>> {
  if (fallback.source === "precise" || !amapKey) return fallback;
  const ip = request.headers.get("CF-Connecting-IP")?.trim();
  if (!ip) return fallback;
  try {
    const key = await hashedIpCacheRequest(ip);
    const cached = await cache.match(key);
    if (cached) {
      const value = await cached.json() as { latitude: number; longitude: number; area: string };
      return {
        ...normalizeCoordinates(value.latitude, value.longitude),
        area: value.area.trim() || fallback.area,
        source: "amap-ip",
      };
    }
    const location = await fetchAmapIpLocation({ ip, key: amapKey, fetcher });
    await cache.put(key, Response.json(location, { headers: ipLocationResponseHeaders }));
    return { ...location, source: "amap-ip" };
  } catch {
    return fallback;
  }
}

async function resolveCachedArea(
  latitude: number,
  longitude: number,
  provider: "amap" | "bigdatacloud",
  cache: WeatherCache,
  resolver: () => Promise<string>,
): Promise<string> {
  const key = reverseCacheRequest(latitude, longitude, provider);
  const cached = await cache.match(key);
  if (cached) return cached.text();
  const area = await resolver();
  await cache.put(key, new Response(area, { headers: reverseResponseHeaders }));
  return area;
}

async function resolvePreciseArea(
  latitude: number,
  longitude: number,
  cache: WeatherCache,
  fetcher: typeof fetch,
  amapKey?: string,
): Promise<string> {
  if (amapKey) {
    try {
      return await resolveCachedArea(latitude, longitude, "amap", cache, () => (
        fetchAmapReverseGeocode({ latitude, longitude, key: amapKey, fetcher })
      ));
    } catch {
      // Fall through to the existing keyless provider when Amap is unavailable.
    }
  }
  return resolveCachedArea(latitude, longitude, "bigdatacloud", cache, () => (
    fetchReverseGeocode({ latitude, longitude, fetcher })
  ));
}

export function createWeatherRoute({
  fetcher = fetch,
  cache,
  amapKey = runtimeAmapKey(),
}: WeatherRouteDependencies = {}): APIRoute {
  return async ({ request }) => {
    try {
      const activeCache = cache ?? weatherCache();
      const location = await resolveAmapIpLocation(
        request,
        routeCoordinates(request),
        amapKey?.trim() || undefined,
        activeCache,
        fetcher,
      );
      const key = cacheRequest(location.latitude, location.longitude, location.source);
      const forceRefresh = new URL(request.url).searchParams.has("refresh");
      const cached = forceRefresh ? undefined : await activeCache.match(key);
      if (cached) return cached;
      let area = location.area;
      if (location.source === "precise") {
        try {
          area = await resolvePreciseArea(
            location.latitude,
            location.longitude,
            activeCache,
            fetcher,
            amapKey?.trim() || undefined,
          );
        } catch {
          area = "当前位置";
        }
      }
      const snapshot = await fetchWeatherSnapshot({ ...location, area, fetcher });
      const response = Response.json(
        { data: snapshot },
        { headers: forceRefresh ? refreshResponseHeaders : responseHeaders },
      );
      await activeCache.put(key, response.clone());
      return response;
    } catch (error) {
      if (error instanceof WeatherCoordinateError) {
        return Response.json({ error: error.message }, {
          status: 400,
          headers: { "cache-control": "no-store" },
        });
      }
      return Response.json({ error: "天气暂时藏进云里了。" }, {
        status: 503,
        headers: { "cache-control": "no-store" },
      });
    }
  };
}

export const GET = createWeatherRoute();
