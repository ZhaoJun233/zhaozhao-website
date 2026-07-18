import type { APIRoute } from "astro";
import { getDatabase } from "../../../../lib/cloudflare/bindings";
import {
  listEnabledMusicTracks,
  type AdminMusicTrack,
} from "../../../../lib/database/music-repository";

type AudioTrack = Pick<AdminMusicTrack, "id" | "neteaseSongId">;

interface MusicAudioRouteDependencies {
  listTracks?: () => Promise<AudioTrack[]>;
  fetcher?: typeof fetch;
}

const noStoreHeaders = { "cache-control": "private, no-store" };

function errorResponse(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: noStoreHeaders });
}

function redirectResponse(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      ...noStoreHeaders,
      location,
      "referrer-policy": "no-referrer",
    },
  });
}

function safeAudioLocation(value: string, base: string): string | undefined {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (url.hostname !== "music.126.net" && !url.hostname.endsWith(".music.126.net")) {
      return undefined;
    }
    url.protocol = "https:";
    return url.toString();
  } catch {
    return undefined;
  }
}

export function createMusicAudioRoute({
  listTracks = () => listEnabledMusicTracks(getDatabase()),
  fetcher = fetch,
}: MusicAudioRouteDependencies = {}): APIRoute {
  return async ({ params }) => {
    const track = (await listTracks()).find((item) => item.id === params.id);
    if (!track) return errorResponse("歌曲不存在或未启用。", 404);

    const source = `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(track.neteaseSongId)}.mp3`;
    try {
      const upstream = await fetcher(source, {
        redirect: "manual",
        headers: {
          accept: "audio/mpeg,audio/*;q=0.9,*/*;q=0.8",
          referer: "https://music.163.com/",
        },
      });
      const location = upstream.headers.get("location");
      const safeLocation = location ? safeAudioLocation(location, source) : undefined;
      return redirectResponse(safeLocation ?? source);
    } catch {
      return redirectResponse(source);
    }
  };
}

export const GET = createMusicAudioRoute();
