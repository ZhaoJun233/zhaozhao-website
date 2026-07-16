const importForm = document.querySelector<HTMLFormElement>("[data-import-form]");

importForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fileInput = importForm.elements.namedItem("backup") as HTMLInputElement;
  const status = importForm.querySelector<HTMLElement>("[data-admin-status]");
  const file = fileInput.files?.[0];
  if (!file || !status) return;
  if (!window.confirm("导入会替换当前数据库内容，确定继续吗？")) return;
  status.textContent = "正在校验并导入…";
  status.removeAttribute("data-error");
  try {
    const backup = JSON.parse(await file.text());
    const response = await fetch("/api/admin/import/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(backup),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "导入失败。");
    status.textContent = "导入完成，正在刷新后台…";
    window.location.reload();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "导入失败。";
    status.setAttribute("data-error", "");
  }
});

export {};
