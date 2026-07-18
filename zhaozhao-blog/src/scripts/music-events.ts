export type MusicSelection = {
  id: string;
  title: string;
  artist: string;
  embedUrl: string;
  neteaseUrl: string;
  coverUrl?: string;
  audioUrl?: string;
};

export type MusicPlaybackCommand = {
  action: "toggle" | "seek" | "volume";
  value?: number;
};

export type MusicPlaybackState = {
  track?: MusicSelection;
  canPlay: boolean;
  playing: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  error?: string;
};

declare global {
  interface DocumentEventMap {
    "site:music-select": CustomEvent<MusicSelection>;
    "site:music-change": CustomEvent<MusicSelection>;
    "site:music-command": CustomEvent<MusicPlaybackCommand>;
    "site:music-state": CustomEvent<MusicPlaybackState>;
    "site:music-state-request": CustomEvent<void>;
  }
}
