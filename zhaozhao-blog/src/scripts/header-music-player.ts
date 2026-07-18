import { musicTrackMatchesQuery } from "../lib/header-widgets";
import type {
  MusicPlaybackCommand,
  MusicPlaybackState,
  MusicSelection,
} from "./music-events";

function playerRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-header-music-player]");
}

function audioFrom(root: HTMLElement): HTMLAudioElement | null {
  return root.querySelector<HTMLAudioElement>("[data-site-audio]");
}

function setPlayerOpen(root: HTMLElement, open: boolean): void {
  const trigger = root.querySelector<HTMLButtonElement>("[data-header-music-trigger]");
  const panel = root.querySelector<HTMLElement>("[data-header-music-panel]");
  root.dataset.playerOpen = String(open);
  trigger?.setAttribute("aria-expanded", String(open));
  trigger?.setAttribute("aria-label", open ? "关闭音乐播放器" : "打开音乐播放器");
  if (panel) panel.hidden = !open;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const rounded = Math.floor(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function selectedTrackFromRoot(root: HTMLElement): MusicSelection | undefined {
  const {
    trackId,
    trackTitle,
    trackArtist,
    trackCover,
    trackAudio,
    trackEmbed,
    trackUrl,
  } = root.dataset;
  if (!trackId || !trackTitle || !trackEmbed || !trackUrl) return undefined;
  return {
    id: trackId,
    title: trackTitle,
    artist: trackArtist ?? "",
    embedUrl: trackEmbed,
    neteaseUrl: trackUrl,
    ...(trackCover ? { coverUrl: trackCover } : {}),
    ...(trackAudio ? { audioUrl: trackAudio } : {}),
  };
}

function playbackState(root: HTMLElement): MusicPlaybackState {
  const audio = audioFrom(root);
  const track = selectedTrackFromRoot(root);
  const duration = audio && Number.isFinite(audio.duration) ? audio.duration : 0;
  return {
    ...(track ? { track } : {}),
    canPlay: Boolean(track?.audioUrl),
    playing: Boolean(audio && !audio.paused && !audio.ended),
    currentTime: audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
    duration,
    volume: audio?.volume ?? 1,
    ...(audio?.dataset.playbackError ? { error: audio.dataset.playbackError } : {}),
  };
}

function updateHeaderControls(root: HTMLElement, state: MusicPlaybackState): void {
  const toggle = root.querySelector<HTMLButtonElement>("[data-header-music-toggle]");
  const icon = root.querySelector<HTMLElement>("[data-header-music-toggle-icon]");
  const status = root.querySelector<HTMLElement>("[data-header-music-status]");
  const progress = root.querySelector<HTMLInputElement>("[data-header-music-progress]");
  const volume = root.querySelector<HTMLInputElement>("[data-header-music-volume]");
  const current = root.querySelector<HTMLElement>("[data-header-music-current]");
  const duration = root.querySelector<HTMLElement>("[data-header-music-duration]");
  const progressValue = state.duration > 0
    ? Math.round((state.currentTime / state.duration) * 1000)
    : 0;

  root.dataset.playing = String(state.playing);
  if (toggle) {
    toggle.disabled = !state.canPlay;
    toggle.setAttribute("aria-pressed", String(state.playing));
    toggle.setAttribute("aria-label", state.playing ? "暂停音乐" : "播放音乐");
  }
  if (icon) icon.textContent = state.playing ? "❚❚" : "▶";
  if (status) {
    status.textContent = state.error
      ?? (!state.track
        ? "从下方曲目中选择歌曲"
        : !state.canPlay
          ? "这首歌尚未配置音频地址"
          : state.playing ? "正在播放" : "已暂停");
  }
  if (progress) {
    progress.disabled = !state.canPlay || state.duration <= 0;
    progress.value = String(progressValue);
  }
  if (volume) volume.value = String(Math.round(state.volume * 100));
  if (current) current.textContent = formatTime(state.currentTime);
  if (duration) duration.textContent = formatTime(state.duration);
}

function emitState(root: HTMLElement): void {
  const state = playbackState(root);
  updateHeaderControls(root, state);
  document.dispatchEvent(new CustomEvent<MusicPlaybackState>("site:music-state", {
    detail: state,
  }));
}

function resolveTrack(root: HTMLElement, track: MusicSelection): MusicSelection {
  const trackButton = [...root.querySelectorAll<HTMLButtonElement>("[data-header-track]")]
    .find((item) => item.dataset.trackId === track.id);
  return {
    ...track,
    ...(track.coverUrl || !trackButton?.dataset.trackCover
      ? {}
      : { coverUrl: trackButton.dataset.trackCover }),
    ...(track.audioUrl || !trackButton?.dataset.trackAudio
      ? {}
      : { audioUrl: trackButton.dataset.trackAudio }),
  };
}

function selectTrack(root: HTMLElement, incoming: MusicSelection): void {
  const track = resolveTrack(root, incoming);
  const audio = audioFrom(root);
  const sameTrack = root.dataset.trackId === track.id;

  root.dataset.trackId = track.id;
  root.dataset.trackTitle = track.title;
  root.dataset.trackArtist = track.artist;
  root.dataset.trackEmbed = track.embedUrl;
  root.dataset.trackUrl = track.neteaseUrl;
  if (track.coverUrl) root.dataset.trackCover = track.coverUrl;
  else delete root.dataset.trackCover;
  if (track.audioUrl) root.dataset.trackAudio = track.audioUrl;
  else delete root.dataset.trackAudio;

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

  if (audio && (!sameTrack || audio.getAttribute("src") !== (track.audioUrl ?? null))) {
    audio.pause();
    delete audio.dataset.playbackError;
    if (track.audioUrl) audio.src = track.audioUrl;
    else audio.removeAttribute("src");
    audio.load();
  }

  document.dispatchEvent(new CustomEvent<MusicSelection>("site:music-change", { detail: track }));
  emitState(root);
}

function selectionFromButton(button: HTMLButtonElement): MusicSelection | undefined {
  const {
    trackId,
    trackTitle,
    trackArtist,
    trackCover,
    trackAudio,
    trackEmbed,
    trackUrl,
  } = button.dataset;
  if (!trackId || !trackTitle || !trackEmbed || !trackUrl) return undefined;
  return {
    id: trackId,
    title: trackTitle,
    artist: trackArtist ?? "",
    embedUrl: trackEmbed,
    neteaseUrl: trackUrl,
    ...(trackCover ? { coverUrl: trackCover } : {}),
    ...(trackAudio ? { audioUrl: trackAudio } : {}),
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

function showTrackCover(button: HTMLButtonElement, coverUrl: string): void {
  button.dataset.trackCover = coverUrl;
  const cover = button.querySelector<HTMLElement>(".header-music-player__track-cover");
  if (!cover) return;
  const image = document.createElement("img");
  image.src = coverUrl;
  image.alt = "";
  image.loading = "lazy";
  cover.replaceChildren(image);
}

async function loadTrackCovers(root: HTMLElement): Promise<void> {
  if (root.dataset.coverLoad === "loading" || root.dataset.coverLoad === "complete") return;
  root.dataset.coverLoad = "loading";
  try {
    const response = await fetch(root.dataset.coverEndpoint ?? "/api/music/covers/", {
      headers: { accept: "application/json" },
    });
    const result = await response.json() as { data?: Record<string, string> };
    if (!response.ok || !result.data) throw new Error("专辑封面读取失败");
    for (const button of root.querySelectorAll<HTMLButtonElement>("[data-header-track]")) {
      const coverUrl = button.dataset.trackId ? result.data[button.dataset.trackId] : undefined;
      if (coverUrl?.trim()) showTrackCover(button, coverUrl);
    }
    const selected = selectedTrackFromRoot(root);
    const selectedCover = selected ? result.data[selected.id] : undefined;
    if (selected && selectedCover?.trim()) {
      const withCover = { ...selected, coverUrl: selectedCover };
      root.dataset.trackCover = selectedCover;
      document.dispatchEvent(new CustomEvent<MusicSelection>("site:music-change", {
        detail: withCover,
      }));
      emitState(root);
    }
    root.dataset.coverLoad = "complete";
  } catch {
    delete root.dataset.coverLoad;
  }
}

async function applyCommand(root: HTMLElement, command: MusicPlaybackCommand): Promise<void> {
  const audio = audioFrom(root);
  if (!audio) return;
  if (command.action === "toggle") {
    if (!root.dataset.trackAudio) return;
    if (audio.paused || audio.ended) {
      try {
        delete audio.dataset.playbackError;
        await audio.play();
      } catch {
        audio.dataset.playbackError = "浏览器未能播放这个音频地址";
        emitState(root);
      }
    } else {
      audio.pause();
    }
    return;
  }
  if (command.action === "seek" && Number.isFinite(command.value) && audio.duration > 0) {
    audio.currentTime = audio.duration * Math.min(1000, Math.max(0, command.value!)) / 1000;
    emitState(root);
    return;
  }
  if (command.action === "volume" && Number.isFinite(command.value)) {
    audio.volume = Math.min(100, Math.max(0, command.value!)) / 100;
  }
}

function initializeHeaderMusicPlayer(): void {
  const root = playerRoot();
  if (!root) return;
  void loadTrackCovers(root);
  if (root.dataset.playerReady === "true") {
    emitState(root);
    return;
  }
  root.dataset.playerReady = "true";

  root.addEventListener("click", (event) => {
    const target = event.target as Element;
    const trackButton = target.closest<HTMLButtonElement>("[data-header-track]");
    if (trackButton) {
      const selection = selectionFromButton(trackButton);
      if (selection) selectTrack(root, selection);
      return;
    }
    if (target.closest("[data-header-music-toggle]")) {
      void applyCommand(root, { action: "toggle" });
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
  root.querySelector<HTMLInputElement>("[data-header-music-progress]")
    ?.addEventListener("input", (event) => {
      void applyCommand(root, {
        action: "seek",
        value: Number((event.currentTarget as HTMLInputElement).value),
      });
    });
  root.querySelector<HTMLInputElement>("[data-header-music-volume]")
    ?.addEventListener("input", (event) => {
      void applyCommand(root, {
        action: "volume",
        value: Number((event.currentTarget as HTMLInputElement).value),
      });
    });

  const audio = audioFrom(root);
  for (const eventName of [
    "play",
    "pause",
    "timeupdate",
    "durationchange",
    "loadedmetadata",
    "volumechange",
    "ended",
    "canplay",
  ]) {
    audio?.addEventListener(eventName, () => emitState(root));
  }
  audio?.addEventListener("error", () => {
    audio.dataset.playbackError = "音频地址暂时无法播放";
    emitState(root);
  });
  emitState(root);
}

document.addEventListener("site:music-select", (event) => {
  const root = playerRoot();
  if (root) selectTrack(root, event.detail);
});

document.addEventListener("site:music-command", (event) => {
  const root = playerRoot();
  if (root) void applyCommand(root, event.detail);
});

document.addEventListener("site:music-state-request", () => {
  const root = playerRoot();
  if (root) emitState(root);
});

initializeHeaderMusicPlayer();
document.addEventListener("astro:page-load", initializeHeaderMusicPlayer);

export {};
