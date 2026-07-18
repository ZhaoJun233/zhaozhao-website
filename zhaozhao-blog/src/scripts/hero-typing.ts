type TypingState = {
  phraseIndex: number;
  characterIndex: number;
  deleting: boolean;
  timer?: number;
};

const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const targetStates = new Map<HTMLElement, TypingState>();

function readPhrases(target: HTMLElement): string[] {
  try {
    const value = JSON.parse(target.dataset.phrases ?? "[]");
    return Array.isArray(value) && value.every((phrase) => typeof phrase === "string")
      ? value.filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function clearTimer(state: TypingState): void {
  if (state.timer !== undefined) {
    window.clearTimeout(state.timer);
    state.timer = undefined;
  }
}

function schedule(target: HTMLElement, delay: number): void {
  const state = targetStates.get(target);
  if (!state || document.hidden || motionPreference.matches) return;

  clearTimer(state);
  state.timer = window.setTimeout(() => typeNext(target), delay);
}

function typeNext(target: HTMLElement): void {
  const phrases = readPhrases(target);
  const state = targetStates.get(target);
  if (!state || phrases.length === 0 || document.hidden || motionPreference.matches) return;

  const phrase = Array.from(phrases[state.phraseIndex] ?? phrases[0]);
  state.characterIndex += state.deleting ? -1 : 1;
  target.textContent = phrase.slice(0, state.characterIndex).join("");

  if (!state.deleting && state.characterIndex >= phrase.length) {
    state.deleting = true;
    schedule(target, 1900);
    return;
  }

  if (state.deleting && state.characterIndex <= 0) {
    state.deleting = false;
    state.phraseIndex = (state.phraseIndex + 1) % phrases.length;
    schedule(target, 420);
    return;
  }

  schedule(target, state.deleting ? 42 : 88);
}

function setMotionState(): void {
  const paused = document.hidden || motionPreference.matches;
  document.documentElement.toggleAttribute("data-motion-paused", paused);

  for (const [target, state] of targetStates) {
    if (!target.isConnected) {
      clearTimer(state);
      targetStates.delete(target);
      continue;
    }
    const phrases = readPhrases(target);
    if (phrases.length === 0) continue;

    clearTimer(state);
    if (motionPreference.matches) {
      state.phraseIndex = 0;
      state.characterIndex = Array.from(phrases[0]).length;
      state.deleting = false;
      target.textContent = phrases[0];
    } else if (!document.hidden) {
      schedule(target, 650);
    }
  }
}

function initializeTypingTargets(): void {
  document.querySelectorAll<HTMLElement>("[data-hero-typing]").forEach((target) => {
    if (targetStates.has(target)) return;
    const phrases = readPhrases(target);
    if (phrases.length === 0) return;
    targetStates.set(target, {
      phraseIndex: 0,
      characterIndex: Array.from(phrases[0]).length,
      deleting: true,
    });
  });
  setMotionState();
}

document.addEventListener("visibilitychange", setMotionState);
motionPreference.addEventListener("change", setMotionState);
document.addEventListener("astro:page-load", initializeTypingTargets);
document.addEventListener("astro:after-swap", setMotionState);
initializeTypingTargets();
