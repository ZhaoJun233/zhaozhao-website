import { z } from "astro/zod";
import artworkSource from "./artwork.json";

export type ArtworkPlacement = "home-hero" | "home-intro" | "about-hero";

const requiredText = z.string().trim().min(1);
const mediaPath = requiredText.regex(
  /^\/media\/backgrounds\/[\w.-]+\.(?:avif|gif|jpe?g|png|webp)$/i,
  "视觉图片必须位于 public/media/backgrounds。",
);
const schema = z.object({
  homeHero: z.object({ image: mediaPath, title: requiredText, alt: requiredText }),
  aboutSummerDream: z.object({
    image: mediaPath,
    title: requiredText,
    alt: requiredText,
    sourceUrl: z.url({ protocol: /^https?$/ }),
    uploader: requiredText,
    bvid: requiredText,
  }),
});

const source = schema.parse(artworkSource);

export const artwork = {
  homeHero: {
    ...source.homeHero,
    placements: ["home-hero"] as const,
  },
  aboutSummerDream: {
    ...source.aboutSummerDream,
    sourceUrl: source.aboutSummerDream.sourceUrl as `http${string}`,
    placements: ["home-intro", "about-hero"] as const,
  },
};
