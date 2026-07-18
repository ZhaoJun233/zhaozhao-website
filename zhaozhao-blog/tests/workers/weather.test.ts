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
  it("reverse geocodes browser coordinates instead of using the Cloudflare city", async () => {
    const fetched: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      fetched.push(url.toString());
      if (url.origin === "https://api.bigdatacloud.net") {
        return Response.json({
          locality: "徐汇区",
          city: "上海市",
          principalSubdivision: "上海市",
        });
      }
      return weatherUpstream();
    });
    const request = withCf(
      new Request("https://blog.example/api/weather?lat=31.1837&lon=121.4365"),
      { latitude: "30.2741", longitude: "120.1551", city: "杭州" },
    );
    const response = await createWeatherRoute({
      fetcher: fetcher as typeof fetch,
      cache: new MemoryWeatherCache(),
    })({ request } as never);
    const reverseUrl = new URL(fetched[0]!);
    const upstreamUrl = new URL(fetched[1]!);

    expect(response.status).toBe(200);
    expect(reverseUrl.origin).toBe("https://api.bigdatacloud.net");
    expect(upstreamUrl.origin).toBe("https://api.open-meteo.com");
    expect(upstreamUrl.pathname).toBe("/v1/forecast");
    expect(upstreamUrl.searchParams.get("latitude")).toBe("31.1837");
    expect(upstreamUrl.searchParams.get("longitude")).toBe("121.4365");
    expect(await response.json()).toMatchObject({
      data: { area: "徐汇区 · 上海市", condition: "多云", temperature: 28.4 },
    });
  });

  it("caches reverse-geocoded areas on a 0.02 degree grid", async () => {
    let reverseFetches = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.origin === "https://api.bigdatacloud.net") {
        reverseFetches += 1;
        return Response.json({ locality: "徐汇区", city: "上海市" });
      }
      return weatherUpstream();
    });
    const route = createWeatherRoute({
      fetcher: fetcher as typeof fetch,
      cache: new MemoryWeatherCache(),
    });

    await route({
      request: new Request("https://blog.example/api/weather?lat=31.1837&lon=121.4365"),
    } as never);
    const second = await route({
      request: new Request("https://blog.example/api/weather?lat=31.1881&lon=121.446"),
    } as never);

    expect(reverseFetches).toBe(1);
    expect((await second.json()).data.area).toBe("徐汇区 · 上海市");
  });

  it("does not reuse a Cloudflare-labelled snapshot for precise coordinates", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.origin === "https://api.bigdatacloud.net") {
        return Response.json({ locality: "徐汇区", city: "上海市" });
      }
      return weatherUpstream();
    });
    const route = createWeatherRoute({
      fetcher: fetcher as typeof fetch,
      cache: new MemoryWeatherCache(),
    });
    const cloudflareRequest = withCf(new Request("https://blog.example/api/weather"), {
      latitude: "31.1837",
      longitude: "121.4365",
      city: "杭州",
    });

    await route({ request: cloudflareRequest } as never);
    const preciseResponse = await route({
      request: new Request("https://blog.example/api/weather?lat=31.1837&lon=121.4365"),
    } as never);

    expect((await preciseResponse.json()).data.area).toBe("徐汇区 · 上海市");
  });

  it("uses 当前位置信息 when precise reverse geocoding fails", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.origin === "https://api.bigdatacloud.net") {
        return new Response("reverse failed", { status: 502 });
      }
      return weatherUpstream();
    });
    const request = withCf(
      new Request("https://blog.example/api/weather?lat=31.1837&lon=121.4365"),
      { latitude: "30.2741", longitude: "120.1551", city: "杭州" },
    );
    const response = await createWeatherRoute({
      fetcher: fetcher as typeof fetch,
      cache: new MemoryWeatherCache(),
    })({ request } as never);

    expect((await response.json()).data.area).toBe("当前位置");
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
    const secondResponse = await route({ request: second } as never);
    expect(secondResponse.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URL(fetched[0]!).searchParams.get("latitude"))
      .toBe("30.2741");
    expect((await secondResponse.json()).data.area).toBe("杭州");
  });

  it("bypasses the IP weather cache for a manual address refresh", async () => {
    let weatherFetches = 0;
    const fetcher = vi.fn(async () => {
      weatherFetches += 1;
      return weatherUpstream();
    });
    const route = createWeatherRoute({
      fetcher: fetcher as typeof fetch,
      cache: new MemoryWeatherCache(),
    });
    const cf = {
      latitude: "30.2741",
      longitude: "120.1551",
      city: "杭州",
    };

    await route({ request: withCf(new Request("https://blog.example/api/weather"), cf) } as never);
    const refreshed = await route({
      request: withCf(new Request("https://blog.example/api/weather?refresh=1"), cf),
    } as never);

    expect(refreshed.status).toBe(200);
    expect(weatherFetches).toBe(2);
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
