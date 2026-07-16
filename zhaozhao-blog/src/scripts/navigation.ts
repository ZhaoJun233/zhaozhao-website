const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function initializeNavigation(): void {
  const header = document.querySelector<HTMLElement>("[data-site-header]");
  const navigation = document.querySelector<HTMLElement>("[data-mobile-nav]");
  const panel = navigation?.querySelector<HTMLElement>("[data-nav-panel]");
  const trigger = document.querySelector<HTMLButtonElement>("[data-nav-trigger]");

  const updateHeader = (): void => {
    if (header) header.dataset.scrolled = String(window.scrollY > 24);
  };

  updateHeader();
  if (header?.dataset.scrollReady !== "true") {
    header?.setAttribute("data-scroll-ready", "true");
    window.addEventListener("scroll", updateHeader, { passive: true });
  }

  if (!navigation || !panel || !trigger || navigation.dataset.navReady === "true") return;
  navigation.dataset.navReady = "true";

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
  });

  navigation.addEventListener("click", (event) => {
    const target = event.target as Element;
    if (target.closest("[data-nav-close], [data-nav-link]")) {
      closeNavigation(target.closest("[data-nav-link]") === null);
    }
  });

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
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !navigation.hidden) closeNavigation();
  });

  window.matchMedia("(min-width: 900px)").addEventListener("change", (event) => {
    if (event.matches) closeNavigation(false);
  });
}

initializeNavigation();
document.addEventListener("astro:page-load", initializeNavigation);
