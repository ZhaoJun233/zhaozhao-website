const loginForm = document.querySelector<HTMLFormElement>("[data-admin-login]");
const logoutButton = document.querySelector<HTMLButtonElement>("[data-admin-logout]");

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = loginForm.querySelector<HTMLElement>("[data-admin-status]");
  const button = loginForm.querySelector<HTMLButtonElement>("button[type='submit']");
  const password = new FormData(loginForm).get("password");
  if (button) button.disabled = true;
  if (status) { status.textContent = "正在验证…"; status.removeAttribute("data-error"); }
  try {
    const response = await fetch("/api/admin/session/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "登录失败。");
    window.location.assign("/admin/");
  } catch (error) {
    if (status) { status.textContent = error instanceof Error ? error.message : "登录失败。"; status.setAttribute("data-error", ""); }
  } finally {
    if (button) button.disabled = false;
  }
});

export {};

logoutButton?.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await fetch("/api/admin/session/", { method: "DELETE" });
  } finally {
    window.location.assign("/admin/login/");
  }
});
