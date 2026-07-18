import type { MusicSelection } from "./music-events";
import { musicTrackMatchesQuery } from "../lib/header-widgets";

function playerRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-header-music-player]");
}

function setPlayerOpen(root: HTMLElement, open: boolean): void {
  const trigger = root.querySelector<HTMLButtonElement>("[data-header-music-trigger]");
  const panel = root.querySelector<HTMLElement>("[data-header-music-panel]");
  root.dataset.playerOpen = String(open);
  trigger?.setAttribute("aria-expanded", String(open));
  trigger?.setAttribute("aria-label", open ? "关闭音乐播放器" : "打开音乐播放器");
  if (panel) panel.hidden = !open;
}

function selectTrack(root: HTMLElement, track: MusicSelection): void {
  const frame = root.querySelector<HTMLElement>("[data-header-music-frame]");
  const currentFrame = frame?.querySelector<HTMLIFrameElement>("iframe");
  const isSameTrack = root.dataset.trackId === track.id && currentFrame !== null;

  root.dataset.trackId = track.id;
  root.dataset.trackTitle = track.title;
  root.dataset.trackArtist = track.artist;
  root.dataset.trackEmbed = track.embedUrl;
  root.dataset.trackUrl = track.neteaseUrl;
  if (track.coverUrl) root.dataset.trackCover = track.coverUrl;
  else delete root.dataset.trackCover;

  const compactTitle = root.querySelector<HTMLElement>("[data-header-music-title]");
  const panelTitle = root.querySelector<HTMLElement>("[data-header-music-panel-title]");
  const artist = root.querySelector<HTMLElement>("[data-header-music-artist]");
  const link = root.querySelector<HTMLAnchorElement>("[data-header-music-link]");
  if (compactTitle) compactTitle.textContent = track.title;
  if (panelTitle) panelTitle.textContent = track.title;
  if (artist) artist.textContent = track.artist;
  if (link) link.href = track.neteaseUrl;
  for (const item of root.querySelectorAll<HTMLButtonElement>("[data-header-track]")) {
    item.setAttribute("aria-pressed", String(item.dataset.trackId === track.id));
  }

  if (!isSameTrack && frame) {
    const iframe = document.createElement("iframe");
    iframe.src = track.embedUrl;
    iframe.title = `网易云音乐播放器：${track.title}`;
    iframe.loading = "lazy";
    iframe.allow = "autoplay; encrypted-media";
    frame.replaceChildren(iframe);
  }

  setPlayerOpen(root, true);
  document.dispatchEvent(new CustomEvent<MusicSelection>("site:music-change", { detail: track }));
}

function selectionFromButton(button: HTMLButtonElement): MusicSelection | undefined {
  const { trackId, trackTitle, trackArtist, trackCover, trackEmbed, trackUrl } = button.dataset;
  if (!trackId || !trackTitle || !trackEmbed || !trackUrl) return undefined;
  return {
    id: trackId,
    title: trackTitle,
    artist: trackArtist ?? "",
    embedUrl: trackEmbed,
    neteaseUrl: trackUrl,
    ...(trackCover ? { coverUrl: trackCover } : {}),
  };
}

function filterTracks(root: HTMLElement, query: string): void {
  let matches = 0;
  for (const item of root.querySelectorAll<HTMLButtonElement>("[data-header-track]")) {
    const visible = musicTrackMatchesQuery({
      title: item.dataset.trackTitle ?? "",
      artist: item.dataset.trackArtist ?? "",
      note: item.dataset.trackNote ?? "",
    }, query);
    item.hidden = !visible;
    if (visible) matches += 1;
  }
  const empty = root.querySelector<HTMLElement>("[data-header-music-empty]");
  if (empty) empty.hidden = matches > 0;
}

function initializeHeaderMusicPlayer(): void {
  const root = playerRoot();
  if (!root || root.dataset.playerReady === "true") return;
  root.dataset.playerReady = "true";

  root.addEventListener("click", (event) => {
    const target = event.target as Element;
    const trackButton = target.closest<HTMLButtonElement>("[data-header-track]");
    if (trackButton) {
      const selection = selectionFromButton(trackButton);
      if (selection) selectTrack(root, selection);
      return;
    }
    if (target.closest("[data-header-music-trigger]")) {
      setPlayerOpen(root, root.dataset.playerOpen !== "true");
      return;
    }
    if (target.closest("[data-header-music-close]")) setPlayerOpen(root, false);
  });

  root.querySelector<HTMLInputElement>("[data-header-music-search]")
    ?.addEventListener("input", (event) => {
      filterTracks(root, (event.currentTarget as HTMLInputElement).value);
    });
}

document.addEventListener("site:music-select", (event) => {
  const root = playerRoot();
  if (root) selectTrack(root, event.detail);
});

document.addEventListener("site:music-player-open", () => {
  const root = playerRoot();
  if (root) setPlayerOpen(root, true);
});

initializeHeaderMusicPlayer();
document.addEventListener("astro:page-load", initializeHeaderMusicPlayer);

export {};
