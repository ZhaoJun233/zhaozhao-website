const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

let headerFrame = 0;
let activeNavigation: HTMLElement | undefined;
let cleanupActiveNavigation: (() => void) | undefined;

function updateHeader(): void {
  headerFrame = 0;
  const header = document.querySelector<HTMLElement>("[data-site-header]");
  if (!header) return;
  const scrolled = String(window.scrollY > 24);
  if (header.dataset.scrolled !== scrolled) header.dataset.scrolled = scrolled;
}

function scheduleHeaderUpdate(): void {
  if (headerFrame !== 0) return;
  headerFrame = window.requestAnimationFrame(updateHeader);
}

window.addEventListener("scroll", scheduleHeaderUpdate, { passive: true });

function initializeNavigation(): void {
  const navigation = document.querySelector<HTMLElement>("[data-mobile-nav]");
  const panel = navigation?.querySelector<HTMLElement>("[data-nav-panel]");
  const trigger = document.querySelector<HTMLButtonElement>("[data-nav-trigger]");

  updateHeader();
  if (navigation && navigation === activeNavigation) return;
  cleanupActiveNavigation?.();
  activeNavigation = navigation ?? undefined;
  if (!navigation || !panel || !trigger) return;
  const controller = new AbortController();
  const { signal } = controller;

  const focusableElements = (): HTMLElement[] =>
    [...panel.querySelectorAll<HTMLElement>(focusableSelector)].filter(
      (element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true",
    );

  const closeNavigation = (restoreFocus = true): void => {
    if (navigation.hidden) return;
    navigation.hidden = true;
    document.documentElement.removeAttribute("data-nav-open");
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus();
  };

  const openNavigation = (): void => {
    navigation.hidden = false;
    document.documentElement.setAttribute("data-nav-open", "");
    trigger.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => {
      (focusableElements()[0] ?? panel).focus();
    });
  };

  trigger.addEventListener("click", () => {
    if (navigation.hidden) openNavigation();
    else closeNavigation();
  }, { signal });

  navigation.addEventListener("click", (event) => {
    const target = event.target as Element;
    if (target.closest("[data-nav-close], [data-nav-link]")) {
      closeNavigation(target.closest("[data-nav-link]") === null);
    }
  }, { signal });

  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeNavigation();
      return;
    }

    if (event.key !== "Tab") return;

    const elements = focusableElements();
    const first = elements[0];
    const last = elements.at(-1);
    if (!first || !last) {
      event.preventDefault();
      panel.focus();
      return;
    }

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, { signal });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !navigation.hidden) closeNavigation();
  }, { signal });

  window.matchMedia("(min-width: 900px)").addEventListener("change", (event) => {
    if (event.matches) closeNavigation(false);
  }, { signal });

  cleanupActiveNavigation = () => {
    controller.abort();
    if (activeNavigation === navigation) activeNavigation = undefined;
    cleanupActiveNavigation = undefined;
  };
}

initializeNavigation();
document.addEventListener("astro:page-load", initializeNavigation);
