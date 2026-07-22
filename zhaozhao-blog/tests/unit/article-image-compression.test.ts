import { describe, expect, it } from "vitest";
import {
  isAnimatedWebp,
  losslessWebpName,
} from "../../src/lib/admin/article-image-compression";

describe("article image compression", () => {
  it("uses a WebP filename without changing the readable basename", () => {
    expect(losslessWebpName("summer.photo.PNG")).toBe("summer.photo.webp");
    expect(losslessWebpName(".png")).toBe("image.webp");
  });

  it("recognizes the animation flag in an extended WebP header", async () => {
    const header = new Uint8Array(21);
    header.set(new TextEncoder().encode("RIFF"), 0);
    header.set(new TextEncoder().encode("WEBP"), 8);
    header.set(new TextEncoder().encode("VP8X"), 12);
    header[20] = 0x02;

    expect(await isAnimatedWebp(new Blob([header], { type: "image/webp" }))).toBe(true);
    header[20] = 0;
    expect(await isAnimatedWebp(new Blob([header], { type: "image/webp" }))).toBe(false);
  });
});
