const managedPrefix = "uploads/";
const imageExtension = /\.(?:gif|jpe?g|png|webp)$/i;

export function mediaUrlFromKey(key: string): string {
  if (!key.startsWith(managedPrefix) || key.includes("..") || key.includes("\\")) {
    throw new Error("图片路径不正确。");
  }
  return `/media/${key}`;
}

export function mediaKeyFromUrl(value: string): string | undefined {
  const path = value.trim().split(/[?#]/, 1)[0] ?? "";
  const prefix = "/media/";
  if (!path.startsWith(prefix)) return undefined;
  const key = decodeURIComponent(path.slice(prefix.length));
  if (!key.startsWith(managedPrefix) || !imageExtension.test(key)) return undefined;
  if (key.includes("..") || key.includes("\\")) return undefined;
  return key;
}

export function extractManagedImageKeys(markdown: string): string[] {
  const urls: string[] = [];
  for (const match of markdown.matchAll(/!\[[^\]]*\]\((?:<)?([^\s)>]+)(?:>)?(?:\s+['"][^'"]*['"])?\)/g)) {
    if (match[1]) urls.push(match[1]);
  }
  for (const match of markdown.matchAll(/<img\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"][^>]*>/gi)) {
    if (match[1]) urls.push(match[1]);
  }
  return [...new Set(urls.map(mediaKeyFromUrl).filter((key): key is string => Boolean(key)))];
}
