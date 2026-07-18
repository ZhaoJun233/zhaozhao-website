import { describe, expect, it } from "vitest";
import {
  normalizeCoordinates,
  weatherCacheKey,
  weatherCondition,
} from "../../src/lib/weather";

describe("weather helpers", () => {
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

  it("maps WMO weather codes to concise Chinese conditions", () => {
    expect(weatherCondition(0)).toBe("晴");
    expect(weatherCondition(2)).toBe("多云");
    expect(weatherCondition(63)).toBe("雨");
    expect(weatherCondition(95)).toBe("雷雨");
  });
});
