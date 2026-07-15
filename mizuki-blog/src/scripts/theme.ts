export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<ThemePreference, "system">;

const storageKey = "mizuki-theme";
const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
const themeLabels: Record<ThemePreference, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(storageKey);
    return isThemePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  return mediaQuery.matches ? "dark" : "light";
}

function updateControls(preference: ThemePreference): void {
  document.querySelectorAll<HTMLElement>("[data-theme-control]").forEach((control) => {
    const label = control.querySelector<HTMLElement>("[data-theme-label]");
    if (label) label.textContent = `主题：${themeLabels[preference]}`;

    control.querySelectorAll<HTMLButtonElement>("[data-theme-option]").forEach((option) => {
      option.setAttribute(
        "aria-checked",
        String(option.dataset.themeOption === preference),
      );
    });
  });
}

function applyTheme(preference: ThemePreference): void {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
  updateControls(preference);
}

function storePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(storageKey, preference);
  } catch {}
}

function closeMenu(control: HTMLElement, restoreFocus = false): void {
  const trigger = control.querySelector<HTMLButtonElement>("[data-theme-trigger]");
  const menu = control.querySelector<HTMLElement>("[data-theme-menu]");
  if (!trigger || !menu) return;

  menu.hidden = true;
  trigger.setAttribute("aria-expanded", "false");
  if (restoreFocus) trigger.focus();
}

function openMenu(control: HTMLElement): void {
  document.querySelectorAll<HTMLElement>("[data-theme-control]").forEach((other) => {
    if (other !== control) closeMenu(other);
  });

  const trigger = control.querySelector<HTMLButtonElement>("[data-theme-trigger]");
  const menu = control.querySelector<HTMLElement>("[data-theme-menu]");
  if (!trigger || !menu) return;

  menu.hidden = false;
  trigger.setAttribute("aria-expanded", "true");
  const checked = menu.querySelector<HTMLButtonElement>("[aria-checked='true']");
  (checked ?? menu.querySelector<HTMLButtonElement>("button"))?.focus();
}

function initializeControl(control: HTMLElement): void {
  if (control.dataset.themeReady === "true") return;
  control.dataset.themeReady = "true";

  const trigger = control.querySelector<HTMLButtonElement>("[data-theme-trigger]");
  const menu = control.querySelector<HTMLElement>("[data-theme-menu]");
  if (!trigger || !menu) return;

  trigger.addEventListener("click", () => {
    if (menu.hidden) openMenu(control);
    else closeMenu(control, true);
  });

  menu.addEventListener("click", (event) => {
    const option = (event.target as Element).closest<HTMLButtonElement>("[data-theme-option]");
    const preference = option?.dataset.themeOption ?? null;
    if (!isThemePreference(preference)) return;

    storePreference(preference);
    applyTheme(preference);
    closeMenu(control, true);
  });

  menu.addEventListener("keydown", (event) => {
    const options = [...menu.querySelectorAll<HTMLButtonElement>("[data-theme-option]")];
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(control, true);
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const direction = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = (currentIndex + direction + options.length) % options.length;
    options[nextIndex]?.focus();
  });
}

function initializeTheme(): void {
  const preference = readPreference();
  applyTheme(preference);
  document.querySelectorAll<HTMLElement>("[data-theme-control]").forEach(initializeControl);
}

mediaQuery.addEventListener("change", () => {
  const preference = readPreference();
  if (preference === "system") applyTheme(preference);
});

document.addEventListener("click", (event) => {
  const target = event.target as Node;
  document.querySelectorAll<HTMLElement>("[data-theme-control]").forEach((control) => {
    if (!control.contains(target)) closeMenu(control);
  });
});

initializeTheme();
document.addEventListener("astro:page-load", initializeTheme);
