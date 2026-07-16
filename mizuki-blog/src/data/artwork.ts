import { z } from "astro/zod";
import artworkSource from "./artwork.json";

export type ArtworkPlacement = "home-hero" | "home-intro" | "about-hero";

type ArtworkRecord = {
  image: ImageMetadata;
  title: string;
  alt: string;
  placements: readonly ArtworkPlacement[];
  sourceUrl?: `http${string}`;
  uploader?: string;
  bvid?: string;
};

const requiredText = z.string().trim().min(1);
const assetPath = requiredText.regex(
  /^\/src\/assets\/backgrounds\/[\w.-]+\.(?:avif|gif|jpe?g|png|webp)$/i,
  "视觉图片必须位于 src/assets/backgrounds。",
);
const schema = z.object({
  homeHero: z.object({ image: assetPath, title: requiredText, alt: requiredText }),
  aboutSummerDream: z.object({
    image: assetPath,
    title: requiredText,
    alt: requiredText,
    sourceUrl: z.url({ protocol: /^https?$/ }),
    uploader: requiredText,
    bvid: requiredText,
  }),
});

const source = schema.parse(artworkSource);
const backgroundImages = import.meta.glob<{ default: ImageMetadata }>(
  "../assets/backgrounds/*.{avif,gif,jpeg,jpg,png,webp}",
  { eager: true },
);

function resolveBackground(asset: string): ImageMetadata {
  const filename = asset.split("/").at(-1);
  const image = Object.entries(backgroundImages).find(([path]) =>
    filename ? path.endsWith(`/${filename}`) : false,
  )?.[1].default;

  if (!image) throw new Error(`Background image does not exist: ${asset}`);
  return image;
}

export const artwork: {
  homeHero: ArtworkRecord & { placements: readonly ["home-hero"] };
  aboutSummerDream: ArtworkRecord &
    Required<Pick<ArtworkRecord, "sourceUrl" | "uploader" | "bvid">> & {
      placements: readonly ["home-intro", "about-hero"];
    };
} = {
  homeHero: {
    ...source.homeHero,
    image: resolveBackground(source.homeHero.image),
    placements: ["home-hero"],
  },
  aboutSummerDream: {
    ...source.aboutSummerDream,
    image: resolveBackground(source.aboutSummerDream.image),
    sourceUrl: source.aboutSummerDream.sourceUrl as `http${string}`,
    placements: ["home-intro", "about-hero"],
  },
};
