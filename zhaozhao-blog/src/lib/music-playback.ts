export interface MusicPlaybackTrack {
  id: string;
  audioUrl?: string;
}

export function musicPlaybackUrl(track: MusicPlaybackTrack): string {
  return track.audioUrl?.trim() || `/api/music/audio/${encodeURIComponent(track.id)}/`;
}
