const messagePage = document.querySelector<HTMLElement>("[data-message-page]");

messagePage?.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-message-action]");
  if (!button) return;
  const id = button.dataset.messageId!;
  const action = button.dataset.messageAction!;
  if (action === "delete" && !window.confirm("确定永久删除这条留言吗？")) return;
  button.disabled = true;
  try {
    const response = await fetch(`/api/admin/messages/${id}/`, action === "delete"
      ? { method: "DELETE" }
      : {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ status: action }),
        });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "操作失败。");
    window.location.reload();
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "操作失败。");
    button.disabled = false;
  }
});

export {};
