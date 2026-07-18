import { describe, expect, it, vi } from "vitest";
import { createWeatherRoute } from "../../src/pages/api/weather";

class MemoryWeatherCache {
  private readonly values = new Map<string, Response>();

  async match(request: Request): Promise<Response | undefined> {
    return this.values.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.values.set(request.url, response.clone());
  }
}

function weatherUpstream() {
  return Response.json({
    current: {
      time: "2026-07-18T10:30",
      temperature_2m: 28.4,
      apparent_temperature: 31.2,
      relative_humidity_2m: 72,
      weather_code: 2,
      wind_speed_10m: 11.6,
      wind_direction_10m: 135,
    },
  });
}

function withCf(request: Request, cf: Record<string, unknown>): Request {
  Object.defineProperty(request, "cf", { value: cf, configurable: true });
  return request;
}

describe("weather API", () => {
  it("prefers browser coordinates and only fetches the fixed Open-Meteo host", async () => {
    const fetched: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      return weatherUpstream();
    });
    const request = withCf(
      new Request("https://blog.example/api/weather?lat=31.2304&lon=121.4737"),
      { latitude: "30.2741", longitude: "120.1551", city: "杭州" },
    );
    const response = await createWeatherRoute({
      fetcher: fetcher as typeof fetch,
      cache: new MemoryWeatherCache(),
    })({ request } as never);
    const upstreamUrl = new URL(fetched[0]!);

    expect(response.status).toBe(200);
    expect(upstreamUrl.origin).toBe("https://api.open-meteo.com");
    expect(upstreamUrl.pathname).toBe("/v1/forecast");
    expect(upstreamUrl.searchParams.get("latitude")).toBe("31.2304");
    expect(upstreamUrl.searchParams.get("longitude")).toBe("121.4737");
    expect(await response.json()).toMatchObject({
      data: { area: "杭州", condition: "多云", temperature: 28.4 },
    });
  });

  it("uses Cloudflare coordinates when query coordinates are absent and caches the grid", async () => {
    const fetched: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      return weatherUpstream();
    });
    const cache = new MemoryWeatherCache();
    const route = createWeatherRoute({ fetcher: fetcher as typeof fetch, cache });
    const first = withCf(new Request("https://blog.example/api/weather"), {
      latitude: "30.2741",
      longitude: "120.1551",
      city: "杭州",
    });
    const second = withCf(new Request("https://blog.example/api/weather"), {
      latitude: "30.2742",
      longitude: "120.1552",
      city: "杭州",
    });

    expect((await route({ request: first } as never)).status).toBe(200);
    expect((await route({ request: second } as never)).status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(fetched[0]!).searchParams.get("latitude"))
      .toBe("30.2741");
  });

  it("returns a stable local error when the upstream fails", async () => {
    const route = createWeatherRoute({
      fetcher: vi.fn(async () => new Response("upstream failed", { status: 502 })),
      cache: new MemoryWeatherCache(),
    });
    const response = await route({
      request: new Request("https://blog.example/api/weather?lat=30&lon=120"),
    } as never);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "天气暂时藏进云里了。" });
  });
});
