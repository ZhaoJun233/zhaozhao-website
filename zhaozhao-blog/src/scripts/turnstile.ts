interface TurnstileRenderOptions {
  sitekey: string;
  theme?: "light" | "dark" | "auto";
  "expired-callback"?: () => void;
}

interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string;
  reset(widgetId?: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
    __zhaozhaoTurnstileReady?: () => void;
  }
}

const TURNSTILE_API_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__zhaozhaoTurnstileReady";

let apiPromise: Promise<TurnstileApi | null> | null = null;

function loadTurnstileApi(): Promise<TurnstileApi | null> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  apiPromise ??= new Promise((resolve) => {
    window.__zhaozhaoTurnstileReady = () => resolve(window.turnstile ?? null);
    const script = document.createElement("script");
    script.src = TURNSTILE_API_URL;
    script.async = true;
    script.defer = true;
    script.onerror = () => resolve(null);
    document.head.append(script);
  });
  return apiPromise;
}

function currentTheme(): "light" | "dark" | "auto" {
  const theme = document.documentElement.dataset.theme;
  return theme === "light" || theme === "dark" ? theme : "auto";
}

/**
 * 在声明了 data-turnstile-sitekey 的容器上显式渲染 Turnstile widget。
 * 幂等：同一容器重复调用直接跳过；api.js 只加载一次。
 * 脚本加载失败时静默降级——表单仍可提交，由服务端校验结果给出提示。
 */
export async function mountTurnstile(host: HTMLElement): Promise<void> {
  const sitekey = host.dataset.turnstileSitekey ?? "";
  if (!sitekey || host.dataset.turnstileWidgetId) return;
  const api = await loadTurnstileApi();
  if (!api || host.dataset.turnstileWidgetId || !host.isConnected) return;
  try {
    let widgetId = "";
    widgetId = api.render(host, {
      sitekey,
      theme: currentTheme(),
      // token 有效期 300s，过期后自动重新挑战，避免停留过久提交必失败
      "expired-callback": () => {
        try { api.reset(widgetId); } catch { /* widget 已销毁时忽略 */ }
      },
    });
    host.dataset.turnstileWidgetId = widgetId;
  } catch { /* 渲染失败时保持表单可用，由服务端校验兜底 */ }
}

/** 提交成功/失败后重置 widget，换取下一次提交用的新 token（token 一次性）。 */
export function resetTurnstile(host: HTMLElement | null | undefined): void {
  const widgetId = host?.dataset.turnstileWidgetId;
  if (!widgetId) return;
  try { window.turnstile?.reset(widgetId); } catch { /* widget 已销毁时忽略 */ }
}
