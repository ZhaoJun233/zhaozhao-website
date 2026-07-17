const managedPrefix = "uploads/";
const imageExtension = /\.(?:gif|jpe?g|png|webp)$/i;

export function mediaUrlFromKey(key: string): string {
  if (
    !key.startsWith(managedPrefix)
    || !imageExtension.test(key)
    || key.includes("..")
    || key.includes("\\")
  ) {
    throw new Error("图片路径不正确。");
  }
  return `/media/${key}`;
}

export function mediaKeyFromUrl(value: string): string | undefined {
  const path = value.trim().split(/[?#]/, 1)[0] ?? "";
  const prefix = "/media/";
  if (!path.startsWith(prefix)) return undefined;
  let key: string;
  try {
    key = decodeURIComponent(path.slice(prefix.length));
  } catch {
    return undefined;
  }
  if (!key.startsWith(managedPrefix) || !imageExtension.test(key)) return undefined;
  if (key.includes("..") || key.includes("\\")) return undefined;
  return key;
}

export function extractManagedImageKeys(markdown: string): string[] {
  const matches: Array<{ index: number; url: string }> = [];
  for (const match of markdown.matchAll(/!\[[^\]]*\]\((?:<)?([^\s)>]+)(?:>)?(?:\s+['"][^'"]*['"])?\)/g)) {
    if (match[1]) matches.push({ index: match.index, url: match[1] });
  }
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"][^>]*>/gi)) {
    if (match[1]) matches.push({ index: match.index, url: match[1] });
  }
  const keys = matches
    .sort((left, right) => left.index - right.index)
    .map(({ url }) => mediaKeyFromUrl(url))
    .filter((key): key is string => Boolean(key));
  return [...new Set(keys)];
}
