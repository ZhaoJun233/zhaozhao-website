import aboutSummerDreamImage from "../assets/backgrounds/about-summer-dream.jpg";
import homeHeroImage from "../assets/backgrounds/home-hero.png";

export type ArtworkPlacement = "home-hero" | "home-intro" | "about-hero";

export type ArtworkRecord = {
  image: ImageMetadata;
  title: string;
  alt: string;
  placements: readonly ArtworkPlacement[];
  sourceUrl?: `https://${string}`;
  uploader?: string;
  bvid?: `BV${string}`;
};

export type ArtworkCatalog = {
  homeHero: ArtworkRecord & {
    placements: readonly ["home-hero"];
  };
  aboutSummerDream: ArtworkRecord &
    Required<Pick<ArtworkRecord, "sourceUrl" | "uploader" | "bvid">> & {
      placements: readonly ["home-intro", "about-hero"];
    };
};

export const artwork: ArtworkCatalog = {
  homeHero: {
    image: homeHeroImage,
    title: "233昭首页主视觉",
    alt: "粉蓝海浪间微笑的白发少女插画",
    placements: ["home-hero"],
  },
  aboutSummerDream: {
    image: aboutSummerDreamImage,
    title: "【动态壁纸】夏日白色绮梦",
    alt: "粉紫色海边的白发少女插画",
    sourceUrl: "https://www.bilibili.com/video/BV1NCjx6oEhj/",
    uploader: "清水未萌_Minamo",
    bvid: "BV1NCjx6oEhj",
    placements: ["home-intro", "about-hero"],
  },
};
