const fileInput = document.querySelector<HTMLInputElement>("[data-import-post-file]");
const importButton = document.querySelector<HTMLButtonElement>("[data-import-post]");
const status = document.querySelector<HTMLElement>("[data-record-status]");

function errorMessage(result: { error?: string; fieldErrors?: Record<string, string[]> }): string {
  const detail = Object.values(result.fieldErrors ?? {}).flat().filter(Boolean).join(" ");
  return detail || result.error || "导入失败。";
}

importButton?.addEventListener("click", () => fileInput?.click());

fileInput?.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file || !importButton || !status) return;
  importButton.disabled = true;
  status.textContent = `正在导入 ${file.name}…`;
  status.removeAttribute("data-error");
  try {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/admin/posts/import/", { method: "POST", body });
    const result = await response.json();
    if (!response.ok) throw new Error(errorMessage(result));
    status.textContent = "导入成功，正在刷新文章列表…";
    window.location.reload();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "导入失败。";
    status.setAttribute("data-error", "");
  } finally {
    importButton.disabled = false;
    fileInput.value = "";
  }
});

export {};
