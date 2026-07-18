import type { MusicSelection } from "./music-events";

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

  const compactTitle = root.querySelector<HTMLElement>("[data-header-music-title]");
  const panelTitle = root.querySelector<HTMLElement>("[data-header-music-panel-title]");
  const artist = root.querySelector<HTMLElement>("[data-header-music-artist]");
  const link = root.querySelector<HTMLAnchorElement>("[data-header-music-link]");
  if (compactTitle) compactTitle.textContent = track.title;
  if (panelTitle) panelTitle.textContent = track.title;
  if (artist) artist.textContent = track.artist;
  if (link) link.href = track.neteaseUrl;

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

function initializeHeaderMusicPlayer(): void {
  const root = playerRoot();
  if (!root || root.dataset.playerReady === "true") return;
  root.dataset.playerReady = "true";

  root.addEventListener("click", (event) => {
    const target = event.target as Element;
    if (target.closest("[data-header-music-trigger]")) {
      setPlayerOpen(root, root.dataset.playerOpen !== "true");
      return;
    }
    if (target.closest("[data-header-music-close]")) setPlayerOpen(root, false);
  });
}

document.addEventListener("site:music-select", (event) => {
  const root = playerRoot();
  if (root) selectTrack(root, event.detail);
});

initializeHeaderMusicPlayer();
document.addEventListener("astro:page-load", initializeHeaderMusicPlayer);

export {};
