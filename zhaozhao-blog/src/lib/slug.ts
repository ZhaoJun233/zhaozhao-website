export function taxonomySlug(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[A-Z]/g, (character) => character.toLowerCase())
    .replace(/[\p{P}\s]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}
