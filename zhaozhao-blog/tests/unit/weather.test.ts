import { describe, expect, it, vi } from "vitest";
import {
  fetchAmapIpLocation,
  fetchAmapReverseGeocode,
  fetchReverseGeocode,
  normalizeCoordinates,
  reverseGeocodeCacheKey,
  weatherCacheKey,
  weatherCondition,
} from "../../src/lib/weather";

describe("weather helpers", () => {
  it("resolves a Chinese visitor IP with Amap and uses the rectangle center", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => Response.json({
      status: "1",
      info: "OK",
      infocode: "10000",
      province: "上海市",
      city: "上海市",
      adcode: "310000",
      rectangle: "121.1062,30.7798;121.9225,31.6688",
    }));

    await expect(fetchAmapIpLocation({
      ip: "203.0.113.8",
      key: "test-key",
      fetcher: fetcher as typeof fetch,
    })).resolves.toEqual({
      latitude: 31.2243,
      longitude: 121.51435,
      area: "上海市",
    });

    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.origin).toBe("https://restapi.amap.com");
    expect(url.pathname).toBe("/v3/ip");
    expect(url.searchParams.get("ip")).toBe("203.0.113.8");
    expect(url.searchParams.get("key")).toBe("test-key");
  });

  it("formats a Chinese district from Amap reverse geocoding", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => Response.json({
      status: "1",
      info: "OK",
      infocode: "10000",
      regeocode: {
        formatted_address: "上海市徐汇区漕河泾街道",
        addressComponent: {
          province: "上海市",
          city: [],
          district: "徐汇区",
          adcode: "310104",
        },
      },
    }));

    await expect(fetchAmapReverseGeocode({
      latitude: 31.1837,
      longitude: 121.4365,
      key: "test-key",
      fetcher: fetcher as typeof fetch,
    })).resolves.toBe("徐汇区 · 上海市");

    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.origin).toBe("https://restapi.amap.com");
    expect(url.pathname).toBe("/v3/geocode/regeo");
    expect(url.searchParams.get("location")).toBe("121.4365,31.1837");
  });

  it("normalizes valid coordinates", () => {
    expect(normalizeCoordinates("30.2741", "120.1551")).toEqual({
      latitude: 30.2741,
      longitude: 120.1551,
    });
  });

  it("rejects coordinates outside the earth bounds", () => {
    expect(() => normalizeCoordinates("91", "120")).toThrow("纬度必须在 -90 到 90 之间");
    expect(() => normalizeCoordinates("30", "181")).toThrow("经度必须在 -180 到 180 之间");
  });

  it("uses a two-decimal privacy grid for cache keys", () => {
    expect(weatherCacheKey(30.27419, 120.15519)).toBe("weather:30.27:120.16");
  });

  it("formats a Chinese locality and city from BigDataCloud", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) => Response.json({
      locality: "徐汇区",
      city: "上海市",
      principalSubdivision: "上海市",
    }));

    await expect(fetchReverseGeocode({
      latitude: 31.1837,
      longitude: 121.4365,
      fetcher: fetcher as typeof fetch,
    })).resolves.toBe("徐汇区 · 上海市");

    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.origin).toBe("https://api.bigdatacloud.net");
    expect(url.pathname).toBe("/data/reverse-geocode-client");
    expect(url.searchParams.get("localityLanguage")).toBe("zh");
  });

  it("uses a stable 0.02 degree reverse-geocode cache grid", () => {
    expect(reverseGeocodeCacheKey(31.1837, 121.4365))
      .toBe(reverseGeocodeCacheKey(31.1841, 121.4361));
    expect(reverseGeocodeCacheKey(31.1837, 121.4365))
      .not.toBe(reverseGeocodeCacheKey(31.2041, 121.4565));
  });

  it("maps WMO weather codes to concise Chinese conditions", () => {
    expect(weatherCondition(0)).toBe("晴");
    expect(weatherCondition(2)).toBe("多云");
    expect(weatherCondition(63)).toBe("雨");
    expect(weatherCondition(95)).toBe("雷雨");
  });
});
