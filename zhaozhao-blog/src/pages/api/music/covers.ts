import type { APIRoute } from "astro";
import { getDatabase } from "../../../lib/cloudflare/bindings";
import {
  listEnabledMusicTracks,
  type AdminMusicTrack,
} from "../../../lib/database/music-repository";
import {
  isAllowedNeteaseCoverUrl,
  resolveNeteaseSongMetadata,
  type NeteaseSongMetadata,
} from "../../../lib/netease-metadata";

type CoverTrack = Pick<AdminMusicTrack, "id" | "neteaseSongId" | "coverUrl">;

interface MusicCoversRouteDependencies {
  listTracks?: () => Promise<CoverTrack[]>;
  metadataForSong?: (songId: string) => Promise<NeteaseSongMetadata>;
}

const responseHeaders = { "cache-control": "public, max-age=86400" };

export function createMusicCoversRoute({
  listTracks = () => listEnabledMusicTracks(getDatabase()),
  metadataForSong = (songId) => resolveNeteaseSongMetadata(songId),
}: MusicCoversRouteDependencies = {}): APIRoute {
  return async () => {
    const tracks = await listTracks();
    const entries = await Promise.all(tracks.map(async (track) => {
      if (track.coverUrl) return [track.id, track.coverUrl] as const;
      try {
        const metadata = await metadataForSong(track.neteaseSongId);
        const coverUrl = metadata.coverSourceUrl;
        if (coverUrl && isAllowedNeteaseCoverUrl(coverUrl)) {
          return [track.id, coverUrl] as const;
        }
      } catch {
        // Keep the public player available when NetEase metadata is unavailable.
      }
      return undefined;
    }));

    return Response.json({
      data: Object.fromEntries(entries.filter((entry) => entry !== undefined)),
    }, { headers: responseHeaders });
  };
}

export const GET = createMusicCoversRoute();
