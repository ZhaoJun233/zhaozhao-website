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
  document.dispatchEvent(new CustomEvent("admin:post-import-started", {
    detail: { fileName: file.name },
  }));
  importButton.disabled = true;
  status.textContent = `正在导入 ${file.name}…`;
  status.removeAttribute("data-error");
  let succeeded = false;
  try {
    const body = new FormData();
    body.append("file", file);
    const response = await fetch("/api/admin/posts/import/", { method: "POST", body });
    const result = await response.json();
    if (!response.ok) throw new Error(errorMessage(result));
    document.dispatchEvent(new CustomEvent("admin:post-imported", {
      detail: result.data,
    }));
    succeeded = true;
    status.textContent = "Markdown 已读取，正在更新编辑器…";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "导入失败。";
    status.setAttribute("data-error", "");
  } finally {
    document.dispatchEvent(new CustomEvent("admin:post-import-finished", {
      detail: { success: succeeded },
    }));
    importButton.disabled = false;
    fileInput.value = "";
  }
});

export {};
