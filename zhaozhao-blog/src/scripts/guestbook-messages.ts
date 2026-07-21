import { mountTurnstile, resetTurnstile } from "./turnstile";

function initializeGuestbookMessages(): void {
  document.querySelectorAll<HTMLFormElement>("[data-guestbook-form]").forEach((form) => {
    const turnstileHost = form.querySelector<HTMLElement>("[data-turnstile-sitekey]");
    if (turnstileHost) void mountTurnstile(turnstileHost);
    if (form.dataset.guestbookReady === "true") return;
    form.dataset.guestbookReady = "true";

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = form.querySelector<HTMLElement>("[data-guestbook-status]");
      const submit = form.querySelector<HTMLButtonElement>("button[type='submit']");
      if (!status) return;
      status.textContent = "正在提交…";
      status.removeAttribute("data-error");
      if (submit) submit.disabled = true;
      try {
        const data = Object.fromEntries(new FormData(form));
        const response = await fetch("/api/messages/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "提交失败。");
        form.reset();
        status.textContent = result.message ?? "留言已提交。";
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "提交失败。";
        status.setAttribute("data-error", "");
      } finally {
        // token 一次性，无论成败都换新，保证下一次提交可用
        resetTurnstile(turnstileHost);
        if (submit) submit.disabled = false;
      }
    });
  });
}

initializeGuestbookMessages();
document.addEventListener("astro:page-load", initializeGuestbookMessages);

export {};
