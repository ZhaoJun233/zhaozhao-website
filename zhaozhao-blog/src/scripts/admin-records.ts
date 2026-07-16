type FieldType = "text" | "textarea" | "tags" | "checkbox" | "date";
type FieldConfig = { name: string; type: FieldType; optional?: boolean };
type ResourceConfig = { endpoint: string; fields: FieldConfig[]; confirmName: string; order?: boolean };

const page = document.querySelector<HTMLElement>("[data-record-page]");

if (page) {
  const configElement = document.querySelector<HTMLScriptElement>("[data-record-config]");
  const config = JSON.parse(configElement?.textContent ?? "{}") as ResourceConfig;
  const form = page.querySelector<HTMLFormElement>("[data-record-form]")!;
  const status = page.querySelector<HTMLElement>("[data-record-status]")!;
  const idInput = form.elements.namedItem("id") as HTMLInputElement;
  const title = page.querySelector<HTMLElement>("[data-editor-title]");

  const setStatus = (message: string, error = false) => {
    status.textContent = message;
    status.toggleAttribute("data-error", error);
  };

  const resetForm = () => {
    form.reset();
    idInput.value = "";
    if (title) title.textContent = "新增内容";
    setStatus("");
  };

  const populate = (record: Record<string, unknown>) => {
    resetForm();
    idInput.value = String(record.id ?? "");
    if (title) title.textContent = `编辑：${String(record.name ?? record.title ?? "内容")}`;
    for (const field of config.fields) {
      const control = form.elements.namedItem(field.name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      if (!control) continue;
      const value = record[field.name];
      if (field.type === "checkbox" && control instanceof HTMLInputElement) {
        control.checked = Boolean(value);
      } else if (field.type === "tags") {
        control.value = Array.isArray(value) ? value.join(", ") : "";
      } else if (field.type === "date") {
        control.value = typeof value === "string" ? value.slice(0, 10) : "";
      } else {
        control.value = typeof value === "string" || typeof value === "number" ? String(value) : "";
      }
    }
    form.querySelector<HTMLElement>("input:not([type='hidden']), textarea, select")?.focus();
  };

  const serialize = () => {
    const result: Record<string, unknown> = {};
    for (const field of config.fields) {
      const control = form.elements.namedItem(field.name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      if (!control) continue;
      if (field.type === "checkbox" && control instanceof HTMLInputElement) {
        result[field.name] = control.checked;
        continue;
      }
      const value = control.value.trim();
      if (!value && field.optional) continue;
      result[field.name] = field.type === "tags"
        ? value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean)
        : value;
    }
    return result;
  };

  page.querySelector<HTMLElement>("[data-create-record]")?.addEventListener("click", () => {
    resetForm();
    form.querySelector<HTMLElement>("input:not([type='hidden']), textarea, select")?.focus();
  });
  page.querySelector<HTMLElement>("[data-cancel-edit]")?.addEventListener("click", resetForm);

  page.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    const edit = target.closest<HTMLButtonElement>("[data-edit-record]");
    const remove = target.closest<HTMLButtonElement>("[data-delete-record]");
    const move = target.closest<HTMLButtonElement>("[data-move-record]");
    try {
      if (edit) {
        setStatus("正在读取…");
        const response = await fetch(`${config.endpoint}/${edit.dataset.editRecord}/`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "读取失败。");
        populate(result.data);
        setStatus("");
      }
      if (remove) {
        if (!window.confirm(`确定删除这条${config.confirmName}吗？`)) return;
        const response = await fetch(`${config.endpoint}/${remove.dataset.deleteRecord}/`, { method: "DELETE" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "删除失败。");
        window.location.reload();
      }
      if (move && config.order) {
        const rows = [...page.querySelectorAll<HTMLElement>("[data-record-id]")];
        const current = rows.findIndex((row) => row.dataset.recordId === move.dataset.moveRecord);
        const next = move.dataset.direction === "up" ? current - 1 : current + 1;
        if (current < 0 || next < 0 || next >= rows.length) return;
        [rows[current], rows[next]] = [rows[next], rows[current]];
        const response = await fetch(`${config.endpoint}/order/`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids: rows.map((row) => row.dataset.recordId) }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "排序失败。");
        window.location.reload();
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "操作失败。", true);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>("button[type='submit']");
    if (submit) submit.disabled = true;
    setStatus("正在保存…");
    try {
      const id = idInput.value;
      const response = await fetch(id ? `${config.endpoint}/${id}/` : `${config.endpoint}/`, {
        method: id ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(serialize()),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "保存失败。");
      setStatus("已保存，正在刷新…");
      window.location.reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败。", true);
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

export {};
