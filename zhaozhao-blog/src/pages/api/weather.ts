import type { APIRoute } from "astro";
import {
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
}

interface CloudflareLocation {
  latitude?: string | number;
  longitude?: string | number;
  city?: string;
}

const fallbackCoordinates = { latitude: 30.2741, longitude: 120.1551 };
const responseHeaders = { "cache-control": "public, max-age=600" };
const reverseResponseHeaders = { "cache-control": "public, max-age=3600" };

type LocationSource = "precise" | "cloudflare" | "fallback";

function requestLocation(request: Request): CloudflareLocation {
  return ((request as Request & { cf?: CloudflareLocation }).cf ?? {});
}

function cacheRequest(latitude: number, longitude: number, source: LocationSource): Request {
  const key = weatherCacheKey(latitude, longitude).replaceAll(":", "/");
  return new Request(`https://weather-cache.internal/${source}/${key}`);
}

function reverseCacheRequest(latitude: number, longitude: number): Request {
  const key = reverseGeocodeCacheKey(latitude, longitude).replaceAll(":", "/");
  return new Request(`https://reverse-geocode-cache.internal/${key}`);
}

function weatherCache(): WeatherCache {
  return (caches as CacheStorage & { default: Cache }).default as unknown as WeatherCache;
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

async function resolvePreciseArea(
  latitude: number,
  longitude: number,
  cache: WeatherCache,
  fetcher: typeof fetch,
): Promise<string> {
  const key = reverseCacheRequest(latitude, longitude);
  const cached = await cache.match(key);
  if (cached) return cached.text();
  const area = await fetchReverseGeocode({ latitude, longitude, fetcher });
  await cache.put(key, new Response(area, { headers: reverseResponseHeaders }));
  return area;
}

export function createWeatherRoute({
  fetcher = fetch,
  cache,
}: WeatherRouteDependencies = {}): APIRoute {
  return async ({ request }) => {
    try {
      const activeCache = cache ?? weatherCache();
      const location = routeCoordinates(request);
      const key = cacheRequest(location.latitude, location.longitude, location.source);
      const cached = await activeCache.match(key);
      if (cached) return cached;
      let area = location.area;
      if (location.source === "precise") {
        try {
          area = await resolvePreciseArea(
            location.latitude,
            location.longitude,
            activeCache,
            fetcher,
          );
        } catch {
          area = "当前位置";
        }
      }
      const snapshot = await fetchWeatherSnapshot({ ...location, area, fetcher });
      const response = Response.json({ data: snapshot }, { headers: responseHeaders });
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
