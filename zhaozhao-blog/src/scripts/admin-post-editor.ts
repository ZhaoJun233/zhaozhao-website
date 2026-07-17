import {
  LatestTargetRequest,
  buildPostMediaPayload,
  nextSlugValue,
  postContextKey,
  postUploadCoordinator,
  preparePostContextChange,
  type ClientPostContext,
  type TargetRequest,
} from "../lib/admin/post-editor-state";

type PostContext = ClientPostContext;
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
  const confirmDeleteButton = page.querySelector<HTMLButtonElement>("[data-post-delete-confirm]")!;
  let slugEditedManually = false;
  let editRequestId = 0;
  let contextChangeBusy = false;
  const deleteRequests = new LatestTargetRequest<string>();
  let activeDeleteRequest: TargetRequest<string> | undefined;

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
    postUploadCoordinator.activate(postContextKey(context));
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

  const cleanupDraft = async (draftToken: string) => {
    const response = await fetch(`/api/admin/post-assets/drafts/${draftToken}/`, {
      method: "DELETE",
    });
    const result = await response.json() as ApiResult<unknown>;
    if (!response.ok) throw new Error(messageFrom(result, "草稿图片清理失败。"));
  };

  const contextActions = () => [
    document.querySelector<HTMLButtonElement>("[data-create-record]"),
    document.querySelector<HTMLButtonElement>("[data-import-post]"),
    ...page.querySelectorAll<HTMLButtonElement>("[data-edit-record]"),
    page.querySelector<HTMLButtonElement>("[data-cancel-edit]"),
    page.querySelector<HTMLButtonElement>("[data-post-cover-browse]"),
    page.querySelector<HTMLButtonElement>("[data-post-inline-browse]"),
    page.querySelector<HTMLButtonElement>("[data-post-cover-remove]"),
    ...page.querySelectorAll<HTMLButtonElement>("[data-post-media-action]"),
    form.querySelector<HTMLButtonElement>("button[type='submit']"),
  ].filter((button): button is HTMLButtonElement => Boolean(button));

  const contextActionsLocked = () => contextChangeBusy || postUploadCoordinator.isPending();

  const updateContextActionState = () => {
    const locked = contextActionsLocked();
    for (const button of contextActions()) {
      button.setAttribute("aria-disabled", String(locked));
      if (!button.matches("[data-import-post]")) button.disabled = locked;
    }
    for (const input of page.querySelectorAll<HTMLInputElement>("[data-post-cover-upload], [data-post-inline-upload]")) {
      input.disabled = locked;
    }
    page.querySelector<HTMLElement>("[data-post-cover-dropzone]")
      ?.setAttribute("aria-disabled", String(locked));
    page.toggleAttribute("data-post-action-locked", locked);
  };

  postUploadCoordinator.subscribe(updateContextActionState);

  document.addEventListener("click", (event) => {
    if (!contextActionsLocked()) return;
    const target = event.target as HTMLElement;
    if (!target.closest("[data-create-record], [data-import-post], [data-edit-record], [data-cancel-edit]")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    setStatus("请等待当前图片上传完成。", true);
  }, true);

  const changeContext = async (operation: () => void | Promise<void>) => {
    if (contextChangeBusy) return;
    const version = postUploadCoordinator.currentVersion();
    const context = currentContext();
    contextChangeBusy = true;
    updateContextActionState();
    try {
      await preparePostContextChange(postUploadCoordinator, version, context, cleanupDraft);
      await operation();
    } finally {
      contextChangeBusy = false;
      updateContextActionState();
    }
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
    const media = buildPostMediaPayload({
      draftToken: draftTokenInput.value,
      coverAssetId: coverAssetInput.value,
      retainedAssetIds: retainedAssetsInput.value,
    });
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
      ...media,
    };
  };

  titleInput.addEventListener("input", () => {
    slugInput.value = nextSlugValue(slugInput.value, titleInput.value, slugEditedManually);
  });
  slugInput.addEventListener("input", () => {
    slugEditedManually = true;
  });

  document.querySelector<HTMLElement>("[data-create-record]")?.addEventListener("click", async () => {
    try {
      await changeContext(() => {
        resetNewPost();
        titleInput.focus();
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "新建文章失败。", true);
    }
  });

  page.querySelector<HTMLElement>("[data-cancel-edit]")?.addEventListener("click", async () => {
    try {
      setStatus("正在清理未保存图片…");
      await changeContext(() => {
        resetNewPost();
        titleInput.focus();
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "草稿清理失败。", true);
    }
  });

  document.addEventListener("admin:post-imported", (event) => {
    const detail = (event as CustomEvent<{ post?: PostRecord }>).detail;
    if (!detail?.post) return;
    void changeContext(() => {
      resetNewPost();
      populatePost(detail.post!);
      slugEditedManually = true;
      if (editorTitle) editorTitle.textContent = "检查导入内容";
      titleInput.focus();
    }).catch((error: unknown) => {
      setStatus(error instanceof Error ? error.message : "导入内容切换失败。", true);
    });
  });

  page.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    const editButton = target.closest<HTMLButtonElement>("[data-edit-record]");
    const deleteButton = target.closest<HTMLButtonElement>("[data-delete-record]");
    if (editButton?.dataset.editRecord) {
      try {
        await changeContext(() => editPost(editButton.dataset.editRecord!));
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "文章读取失败。", true);
      }
    }
    if (deleteButton?.dataset.deleteRecord) {
      const request = deleteRequests.begin(deleteButton.dataset.deleteRecord);
      activeDeleteRequest = undefined;
      confirmDeleteButton.disabled = true;
      deleteButton.disabled = true;
      deleteButton.setAttribute("aria-busy", "true");
      deleteStatus.textContent = "正在计算图片影响…";
      deleteStatus.removeAttribute("data-error");
      try {
        const response = await fetch(`/api/admin/posts/${request.target}/delete-preview/`);
        const result = await response.json() as ApiResult<{ exclusive: number; shared: number }>;
        if (!response.ok) throw new Error(messageFrom(result, "删除预览读取失败。"));
        if (deleteRequests.target(request) === undefined) return;
        const preview = result.data ?? { exclusive: 0, shared: 0 };
        page.querySelector<HTMLElement>("[data-post-delete-exclusive]")!.textContent = String(preview.exclusive);
        page.querySelector<HTMLElement>("[data-post-delete-shared]")!.textContent = String(preview.shared);
        deleteStatus.textContent = "";
        activeDeleteRequest = request;
        confirmDeleteButton.disabled = false;
        deleteDialog.showModal();
      } catch (error) {
        if (deleteRequests.target(request) !== undefined) {
          deleteRequests.invalidate();
          setStatus(error instanceof Error ? error.message : "删除预览读取失败。", true);
        }
      } finally {
        deleteButton.disabled = false;
        deleteButton.removeAttribute("aria-busy");
      }
    }
  });

  confirmDeleteButton.addEventListener("click", async (event) => {
    const postId = activeDeleteRequest ? deleteRequests.confirm(activeDeleteRequest) : undefined;
    activeDeleteRequest = undefined;
    if (!postId) return;
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    deleteStatus.textContent = "正在删除文章并整理图片…";
    try {
      const response = await fetch(`/api/admin/posts/${postId}/`, { method: "DELETE" });
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

  deleteDialog.addEventListener("close", () => {
    confirmDeleteButton.disabled = true;
    if (!activeDeleteRequest) return;
    deleteRequests.invalidate();
    activeDeleteRequest = undefined;
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const version = postUploadCoordinator.currentVersion();
    contextChangeBusy = true;
    updateContextActionState();
    setStatus(postUploadCoordinator.isPending(version) ? "正在等待图片上传完成…" : "正在保存文章与图片关系…");
    try {
      await postUploadCoordinator.waitForReady(version);
      setStatus("正在保存文章与图片关系…");
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
    } finally {
      contextChangeBusy = false;
      updateContextActionState();
    }
  });

  resetNewPost();
  queueMicrotask(() => emitContext(currentContext(), []));
  updateContextActionState();
}

export {};
