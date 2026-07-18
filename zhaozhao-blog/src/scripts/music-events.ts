export type MusicSelection = {
  id: string;
  title: string;
  artist: string;
  embedUrl: string;
  neteaseUrl: string;
  coverUrl?: string;
};

declare global {
  interface DocumentEventMap {
    "site:music-select": CustomEvent<MusicSelection>;
    "site:music-change": CustomEvent<MusicSelection>;
    "site:music-player-open": CustomEvent<void>;
  }
}
