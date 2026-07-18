import { z } from "astro/zod";
import {
  musicMetadataInputSchema,
  type MusicMetadataInput,
} from "./admin/schemas";
import { maxMediaBytes } from "./cloudflare/media";
import {
  uploadPostImage,
  type MediaObjectStore,
} from "./cloudflare/post-media";

export interface NeteaseSongMetadata {
  title: string;
  artist: string;
  coverSourceUrl?: string;
}

export interface ImportedNeteaseSongMetadata {
  title: string;
  artist: string;
  coverAssetId?: string;
  coverUrl?: string;
  warning?: string;
}

export interface MetadataCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface ImportNeteaseSongMetadataOptions {
  database: D1Database;
  store: MediaObjectStore;
  input: MusicMetadataInput | unknown;
  fetcher?: typeof fetch;
  cache?: MetadataCache;
}

const songIdSchema = z.string().trim().regex(/^\d{1,20}$/);
const songDetailSchema = z.object({
  songs: z.array(z.object({
    name: z.string().trim().min(1).max(240),
    artists: z.array(z.object({
      name: z.string().trim().min(1).max(240),
    })),
    album: z.object({
      picUrl: z.string().trim().optional().nullable(),
    }),
  })),
});
const cachedMetadataSchema = z.object({
  title: z.string(),
  artist: z.string(),
  coverSourceUrl: z.string().optional(),
});
const coverWarning = "歌曲信息已获取，封面请手动上传。";
const metadataCacheHeaders = { "cache-control": "public, max-age=86400" };
const allowedCoverTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

function defaultMetadataCache(): MetadataCache | undefined {
  if (typeof caches === "undefined") return undefined;
  return (caches as CacheStorage & { default: Cache }).default as unknown as MetadataCache;
}

function metadataCacheRequest(songId: string): Request {
  return new Request(`https://netease-metadata-cache.internal/song/${songId}`);
}

export function isAllowedNeteaseCoverUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && (url.hostname === "music.126.net" || url.hostname.endsWith(".music.126.net"));
  } catch {
    return false;
  }
}

export async function fetchNeteaseSongMetadata(
  songIdInput: string,
  fetcher: typeof fetch = fetch,
): Promise<NeteaseSongMetadata> {
  const songId = songIdSchema.parse(songIdInput);
  const url = new URL("https://music.163.com/api/song/detail");
  url.searchParams.set("ids", JSON.stringify([songId]));
  const response = await fetcher(url, {
    headers: {
      accept: "application/json",
      referer: "https://music.163.com/",
      "user-agent": "Mozilla/5.0 (compatible; ZhaoZhaoBlog/1.0)",
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`NetEase returned ${response.status}.`);
  const song = songDetailSchema.parse(await response.json()).songs[0];
  if (!song) throw new Error("未找到网易云歌曲。");
  const artists = song.artists.map(({ name }) => name.trim()).filter(Boolean);
  if (artists.length === 0) throw new Error("网易云歌曲缺少歌手信息。");
  const coverSourceUrl = song.album.picUrl?.trim();
  return {
    title: song.name,
    artist: artists.join(" / "),
    ...(coverSourceUrl ? { coverSourceUrl } : {}),
  };
}

export async function resolveNeteaseSongMetadata(
  songId: string,
  fetcher: typeof fetch = fetch,
  cache: MetadataCache | undefined = defaultMetadataCache(),
): Promise<NeteaseSongMetadata> {
  const key = metadataCacheRequest(songId);
  if (cache) {
    const cached = await cache.match(key);
    if (cached) {
      try {
        return cachedMetadataSchema.parse(await cached.json());
      } catch {
        // Ignore malformed cache entries and refresh from the fixed upstream.
      }
    }
  }
  const metadata = await fetchNeteaseSongMetadata(songId, fetcher);
  if (cache) {
    await cache.put(key, Response.json(metadata, { headers: metadataCacheHeaders }));
  }
  return metadata;
}

async function downloadCover(
  sourceUrl: string,
  fetcher: typeof fetch,
): Promise<File> {
  if (!isAllowedNeteaseCoverUrl(sourceUrl)) throw new Error("Cover host is not allowed.");
  const response = await fetcher(new URL(sourceUrl), {
    headers: {
      accept: "image/jpeg,image/png,image/webp,image/gif",
      referer: "https://music.163.com/",
      "user-agent": "Mozilla/5.0 (compatible; ZhaoZhaoBlog/1.0)",
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`NetEase cover returned ${response.status}.`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (!contentType || !allowedCoverTypes.has(contentType)) {
    throw new Error("NetEase cover type is not supported.");
  }
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > maxMediaBytes) throw new Error("NetEase cover is too large.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0 || bytes.byteLength > maxMediaBytes) {
    throw new Error("NetEase cover size is invalid.");
  }
  return new File([bytes], "netease-cover", { type: contentType });
}

export async function importNeteaseSongMetadata({
  database,
  store,
  input,
  fetcher = fetch,
  cache = defaultMetadataCache(),
}: ImportNeteaseSongMetadataOptions): Promise<ImportedNeteaseSongMetadata> {
  const value = musicMetadataInputSchema.parse(input);
  const metadata = await resolveNeteaseSongMetadata(value.neteaseSongId, fetcher, cache);
  const base = { title: metadata.title, artist: metadata.artist };
  if (!metadata.coverSourceUrl || !isAllowedNeteaseCoverUrl(metadata.coverSourceUrl)) {
    return { ...base, warning: coverWarning };
  }
  try {
    const file = await downloadCover(metadata.coverSourceUrl, fetcher);
    const asset = await uploadPostImage(database, store, file, {
      draftToken: value.draftToken,
    });
    return {
      ...base,
      coverAssetId: asset.id,
      coverUrl: asset.url,
      warning: undefined,
    };
  } catch {
    return { ...base, warning: coverWarning };
  }
}
