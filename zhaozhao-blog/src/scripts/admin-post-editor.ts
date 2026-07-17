import { taxonomySlug } from "../lib/slug";

type PostContext = { postId?: string; draftToken: string };
type PostAsset = {
  id: string;
  url: string;
  usages: Array<"library" | "cover" | "inline">;
};
type PostRecord = Record<string, unknown> & {
  id?: string;
  title?: string;
};
type ApiResult<T> = {
  data?: T;
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

const page = document.querySelector<HTMLElement>("[data-post-page]");

if (page) {
  const form = page.querySelector<HTMLFormElement>("[data-record-form]")!;
  const status = page.querySelector<HTMLElement>("[data-record-status]")!;
  const editorTitle = page.querySelector<HTMLElement>("[data-editor-title]");
  const contextLabel = page.querySelector<HTMLElement>("[data-post-context-label]");
  const deleteDialog = page.querySelector<HTMLDialogElement>("[data-post-delete-dialog]")!;
  const deleteStatus = page.querySelector<HTMLElement>("[data-post-delete-status]")!;
  const idInput = form.elements.namedItem("id") as HTMLInputElement;
  const draftTokenInput = form.elements.namedItem("draftToken") as HTMLInputElement;
  const coverAssetInput = form.elements.namedItem("coverAssetId") as HTMLInputElement;
  const retainedAssetsInput = form.elements.namedItem("retainedAssetIds") as HTMLInputElement;
  const titleInput = form.elements.namedItem("title") as HTMLInputElement;
  const slugInput = form.elements.namedItem("slug") as HTMLInputElement;
  let slugEditedManually = false;
  let pendingDeleteId = "";
  let editRequestId = 0;

  const messageFrom = (result: ApiResult<unknown>, fallback: string) => {
    const detail = Object.values(result.fieldErrors ?? {}).flat().filter(Boolean).join(" ");
    return detail || result.error || fallback;
  };

  const setStatus = (message: string, error = false) => {
    status.textContent = message;
    status.toggleAttribute("data-error", error);
  };

  const control = (name: string) => form.elements.namedItem(name) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
    | null;

  const setValue = (name: string, value: unknown) => {
    const field = control(name);
    if (!field) return;
    if (field instanceof HTMLInputElement && field.type === "checkbox") {
      field.checked = Boolean(value);
      return;
    }
    if (name === "tags") {
      field.value = Array.isArray(value) ? value.join(", ") : "";
      return;
    }
    if (["publishedAt", "updatedAt"].includes(name)) {
      field.value = typeof value === "string" ? value.slice(0, 10) : "";
      return;
    }
    field.value = typeof value === "string" || typeof value === "number" ? String(value) : "";
  };

  const emitContext = (context: PostContext, assets?: PostAsset[]) => {
    document.dispatchEvent(new CustomEvent("admin:post-context", {
      detail: { ...context, ...(assets ? { assets } : {}) },
    }));
  };

  const currentContext = (): PostContext => ({
    ...(idInput.value ? { postId: idInput.value } : {}),
    draftToken: draftTokenInput.value,
  });

  const defaultDate = () => {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60_000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  };

  const resetNewPost = () => {
    editRequestId += 1;
    form.reset();
    idInput.value = "";
    draftTokenInput.value = crypto.randomUUID();
    coverAssetInput.value = "";
    retainedAssetsInput.value = "[]";
    setValue("publishedAt", defaultDate());
    setValue("draft", true);
    slugEditedManually = false;
    if (editorTitle) editorTitle.textContent = "新增文章";
    if (contextLabel) contextLabel.textContent = "新草稿";
    setStatus("");
    emitContext(currentContext(), []);
  };

  const cleanupUnsavedDraft = async () => {
    if (idInput.value || !draftTokenInput.value) return;
    const response = await fetch(`/api/admin/post-assets/drafts/${draftTokenInput.value}/`, {
      method: "DELETE",
    });
    const result = await response.json() as ApiResult<unknown>;
    if (!response.ok) throw new Error(messageFrom(result, "草稿图片清理失败。"));
  };

  const populatePost = (post: PostRecord) => {
    for (const name of [
      "slug", "title", "description", "body", "publishedAt", "updatedAt", "draft",
      "category", "tags", "cover", "coverAlt", "featured", "series", "canonicalUrl",
    ]) setValue(name, post[name]);
  };

  const editPost = async (postId: string) => {
    const requestId = ++editRequestId;
    setStatus("正在读取文章与图库…");
    const [postResponse, assetsResponse] = await Promise.all([
      fetch(`/api/admin/posts/${postId}/`),
      fetch(`/api/admin/posts/${postId}/assets/`),
    ]);
    const postResult = await postResponse.json() as ApiResult<PostRecord>;
    const assetsResult = await assetsResponse.json() as ApiResult<PostAsset[]>;
    if (requestId !== editRequestId) return;
    if (!postResponse.ok) throw new Error(messageFrom(postResult, "文章读取失败。"));
    if (!assetsResponse.ok) throw new Error(messageFrom(assetsResult, "文章图库读取失败。"));

    const post = postResult.data ?? {};
    const assets = assetsResult.data ?? [];
    form.reset();
    idInput.value = postId;
    draftTokenInput.value = crypto.randomUUID();
    populatePost(post);
    retainedAssetsInput.value = JSON.stringify(assets.map(({ id }) => id));
    coverAssetInput.value = assets.find(({ usages }) => usages.includes("cover"))?.id ?? "";
    slugEditedManually = true;
    if (editorTitle) editorTitle.textContent = `编辑：${String(post.title ?? "文章")}`;
    if (contextLabel) contextLabel.textContent = "已保存文章";
    emitContext(currentContext(), assets);
    setStatus("");
    titleInput.focus();
  };

  const optionalValue = (name: string) => control(name)?.value.trim() || undefined;

  const serializePost = () => {
    const tags = (control("tags")?.value ?? "")
      .split(/[,，\n]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    let retainedAssetIds: string[] = [];
    try {
      const value = JSON.parse(retainedAssetsInput.value || "[]") as unknown;
      retainedAssetIds = Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
    } catch {
      retainedAssetIds = [];
    }
    return {
      slug: slugInput.value.trim(),
      title: titleInput.value.trim(),
      description: control("description")?.value.trim() ?? "",
      body: control("body")?.value ?? "",
      publishedAt: control("publishedAt")?.value ?? "",
      ...(optionalValue("updatedAt") ? { updatedAt: optionalValue("updatedAt") } : {}),
      draft: (control("draft") as HTMLInputElement).checked,
      category: control("category")?.value.trim() ?? "",
      tags,
      ...(optionalValue("cover") ? { cover: optionalValue("cover") } : {}),
      ...(optionalValue("coverAlt") ? { coverAlt: optionalValue("coverAlt") } : {}),
      featured: (control("featured") as HTMLInputElement).checked,
      ...(optionalValue("series") ? { series: optionalValue("series") } : {}),
      ...(optionalValue("canonicalUrl") ? { canonicalUrl: optionalValue("canonicalUrl") } : {}),
      draftToken: draftTokenInput.value,
      ...(coverAssetInput.value ? { coverAssetId: coverAssetInput.value } : {}),
      retainedAssetIds,
    };
  };

  titleInput.addEventListener("input", () => {
    if (!slugEditedManually) slugInput.value = taxonomySlug(titleInput.value);
  });
  slugInput.addEventListener("input", () => {
    slugEditedManually = true;
  });

  document.querySelector<HTMLElement>("[data-create-record]")?.addEventListener("click", async () => {
    try {
      await cleanupUnsavedDraft();
      resetNewPost();
      titleInput.focus();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "新建文章失败。", true);
    }
  });

  page.querySelector<HTMLElement>("[data-cancel-edit]")?.addEventListener("click", async () => {
    try {
      if (!idInput.value) {
        setStatus("正在清理未保存图片…");
        await cleanupUnsavedDraft();
      }
      resetNewPost();
      titleInput.focus();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "草稿清理失败。", true);
    }
  });

  document.addEventListener("admin:post-imported", (event) => {
    const detail = (event as CustomEvent<{ post?: PostRecord }>).detail;
    if (!detail?.post) return;
    populatePost(detail.post);
    slugEditedManually = true;
    if (editorTitle) editorTitle.textContent = idInput.value ? "编辑导入内容" : "检查导入内容";
    titleInput.focus();
  });

  page.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    const editButton = target.closest<HTMLButtonElement>("[data-edit-record]");
    const deleteButton = target.closest<HTMLButtonElement>("[data-delete-record]");
    if (editButton?.dataset.editRecord) {
      try {
        await editPost(editButton.dataset.editRecord);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "文章读取失败。", true);
      }
    }
    if (deleteButton?.dataset.deleteRecord) {
      pendingDeleteId = deleteButton.dataset.deleteRecord;
      deleteStatus.textContent = "正在计算图片影响…";
      deleteStatus.removeAttribute("data-error");
      try {
        const response = await fetch(`/api/admin/posts/${pendingDeleteId}/delete-preview/`);
        const result = await response.json() as ApiResult<{ exclusive: number; shared: number }>;
        if (!response.ok) throw new Error(messageFrom(result, "删除预览读取失败。"));
        const preview = result.data ?? { exclusive: 0, shared: 0 };
        page.querySelector<HTMLElement>("[data-post-delete-exclusive]")!.textContent = String(preview.exclusive);
        page.querySelector<HTMLElement>("[data-post-delete-shared]")!.textContent = String(preview.shared);
        deleteStatus.textContent = "";
        deleteDialog.showModal();
      } catch (error) {
        pendingDeleteId = "";
        setStatus(error instanceof Error ? error.message : "删除预览读取失败。", true);
      }
    }
  });

  page.querySelector<HTMLButtonElement>("[data-post-delete-confirm]")?.addEventListener("click", async (event) => {
    if (!pendingDeleteId) return;
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    deleteStatus.textContent = "正在删除文章并整理图片…";
    try {
      const response = await fetch(`/api/admin/posts/${pendingDeleteId}/`, { method: "DELETE" });
      const result = await response.json() as ApiResult<unknown>;
      if (!response.ok) throw new Error(messageFrom(result, "文章删除失败。"));
      deleteStatus.textContent = "已删除，正在刷新…";
      window.location.reload();
    } catch (error) {
      deleteStatus.textContent = error instanceof Error ? error.message : "文章删除失败。";
      deleteStatus.setAttribute("data-error", "");
      button.disabled = false;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>("button[type='submit']");
    if (submit) submit.disabled = true;
    setStatus("正在保存文章与图片关系…");
    try {
      const postId = idInput.value;
      const response = await fetch(postId ? `/api/admin/posts/${postId}/` : "/api/admin/posts/", {
        method: postId ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(serializePost()),
      });
      const result = await response.json() as ApiResult<unknown>;
      if (!response.ok) throw new Error(messageFrom(result, "文章保存失败。"));
      setStatus("已保存，正在刷新…");
      window.location.reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "文章保存失败。", true);
      if (submit) submit.disabled = false;
    }
  });

  resetNewPost();
  queueMicrotask(() => emitContext(currentContext(), []));
}

export {};
