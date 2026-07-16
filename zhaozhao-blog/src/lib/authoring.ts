function hasContent(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  return value !== undefined && value !== null;
}

export function validatePostCoverPair(cover: unknown, coverAlt: unknown): void {
  if (hasContent(cover) === hasContent(coverAlt)) return;
  throw new Error("封面与封面说明必须同时填写或同时留空。");
}
