import encodeWebp from "@jsquash/webp/encode.js";

const losslessImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface ArticleImageCompressionResult {
  file: File;
  originalBytes: number;
  compressed: boolean;
  animationPreserved: boolean;
}

export function losslessWebpName(name: string): string {
  const basename = name.replace(/\.[^.]+$/, "").trim() || "image";
  return `${basename}.webp`;
}

export async function isAnimatedWebp(file: Blob): Promise<boolean> {
  if (file.type.toLowerCase() !== "image/webp" || file.size < 21) return false;
  const bytes = new Uint8Array(await file.slice(0, 21).arrayBuffer());
  const signature = (start: number, value: string) => (
    [...value].every((character, index) => bytes[start + index] === character.charCodeAt(0))
  );
  return signature(0, "RIFF")
    && signature(8, "WEBP")
    && signature(12, "VP8X")
    && Boolean(bytes[20]! & 0x02);
}

export async function compressArticleImage(
  file: File,
): Promise<ArticleImageCompressionResult> {
  const type = file.type.toLowerCase();
  const unchanged = (animationPreserved = false): ArticleImageCompressionResult => ({
    file,
    originalBytes: file.size,
    compressed: false,
    animationPreserved,
  });

  if (type === "image/gif") return unchanged(true);
  if (!losslessImageTypes.has(type)) return unchanged();
  if (type === "image/webp" && await isAnimatedWebp(file)) return unchanged(true);

  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("浏览器没有可用的图片处理能力。");
    context.drawImage(bitmap, 0, 0);
    const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height);
    const encoded = await encodeWebp(imageData, {
      lossless: 1,
      exact: 1,
      quality: 100,
      method: 4,
    });
    if (encoded.byteLength >= file.size) return unchanged();

    return {
      file: new File([encoded], losslessWebpName(file.name), {
        type: "image/webp",
        lastModified: file.lastModified,
      }),
      originalBytes: file.size,
      compressed: true,
      animationPreserved: false,
    };
  } finally {
    bitmap.close();
  }
}
