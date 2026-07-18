import { describe, expect, it } from "vitest";
import {
  compactWeatherSymbol,
  compactWeatherText,
  musicTrackMatchesQuery,
} from "../../src/lib/header-widgets";

describe("header widget helpers", () => {
  it("formats compact weather", () => {
    expect(compactWeatherSymbol(0)).toBe("☼");
    expect(compactWeatherSymbol(2)).toBe("☁");
    expect(compactWeatherSymbol(63)).toBe("☂");
    expect(compactWeatherSymbol(75)).toBe("❄");
    expect(compactWeatherSymbol(95)).toBe("ϟ");
    expect(compactWeatherText("浙江省 杭州市", 27.6)).toBe("浙江省 杭州市 · 28°");
  });

  it("matches music keywords across title, artist, and note", () => {
    const track = {
      title: "风之子",
      artist: "旅行团乐队",
      note: "适合晚风",
    };

    expect(musicTrackMatchesQuery(track, "风之子")).toBe(true);
    expect(musicTrackMatchesQuery(track, "旅行团")).toBe(true);
    expect(musicTrackMatchesQuery(track, "晚 风")).toBe(true);
    expect(musicTrackMatchesQuery(track, "  ")).toBe(true);
    expect(musicTrackMatchesQuery(track, "爵士")).toBe(false);
  });
});
