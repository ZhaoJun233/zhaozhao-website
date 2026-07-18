import { describe, expect, it } from "vitest";
import { siteConfig } from "../../src/config/site";

describe("siteConfig", () => {
  it("uses the Chinese locale and stable route contract", () => {
    expect(siteConfig.locale).toBe("zh-CN");
    expect(siteConfig.timeZone).toBe("Asia/Shanghai");
    expect(siteConfig.pageSize).toBe(8);
    expect(siteConfig.navigation.map((item) => item.href)).toEqual([
      "/", "/posts/", "/categories/", "/archive/", "/projects/",
      "/friends/", "/now/", "/about/", "/guestbook/"
    ]);
  });
});
