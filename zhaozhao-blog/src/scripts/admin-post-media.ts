type PostContext = { postId?: string; draftToken: string };
type MediaAsset = {
  id: string;
  key: string;
  url: string;
  originalName: string;
  contentType: string;
  sizeBytes?: number;
  usages: Array<"library" | "cover" | "inline">;
  sharedBy: number;
};
type PostContextDetail = PostContext & { assets?: MediaAsset[] };
type ApiResult<T> = {
  data?: T;
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

const page = document.querySelector<HTMLElement>("[data-post-page]");

if (page) {
  const form = page.querySelector<HTMLFormElement>("[data-record-form]")!;
  const coverInput = form.elements.namedItem("cover") as HTMLInputElement;
  const coverAltInput = form.elements.namedItem("coverAlt") as HTMLInputElement;
  const coverAssetInput = form.elements.namedItem("coverAssetId") as HTMLInputElement;
  const retainedAssetsInput = form.elements.namedItem("retainedAssetIds") as HTMLInputElement;
  const bodyInput = form.elements.namedItem("body") as HTMLTextAreaElement;
  const coverFileInput = page.querySelector<HTMLInputElement>("[data-post-cover-upload]")!;
  const inlineFileInput = page.querySelector<HTMLInputElement>("[data-post-inline-upload]")!;
  const dropzone = page.querySelector<HTMLElement>("[data-post-cover-dropzone]")!;
  const coverImage = page.querySelector<HTMLImageElement>("[data-post-cover-image]")!;
  const coverEmpty = page.querySelector<HTMLElement>("[data-post-cover-empty]")!;
  const mediaList = page.querySelector<HTMLElement>("[data-post-media-list]")!;
  const mediaEmpty = page.querySelector<HTMLElement>("[data-post-media-empty]")!;
  const mediaStatus = page.querySelector<HTMLElement>("[data-post-media-status]")!;
  const assets = new Map<string, MediaAsset>();
  let context: PostContext = { draftToken: "" };
  let contextVersion = 0;
  let backfillStarted = false;

  const messageFrom = (result: ApiResult<unknown>, fallback: string) => {
    const detail = Object.values(result.fieldErrors ?? {}).flat().filter(Boolean).join(" ");
    return detail || result.error || fallback;
  };

  const setMediaStatus = (message: string, error = false, progress = false) => {
    mediaStatus.textContent = message;
    mediaStatus.toggleAttribute("data-error", error);
    mediaStatus.toggleAttribute("data-progress", Boolean(message) && !error && progress);
  };

  const usageLabel = (usage: MediaAsset["usages"][number]) => ({
    cover: "封面",
    inline: "正文",
    library: "图库",
  })[usage];

  const formatSize = (size?: number) => {
    if (size === undefined) return "大小未知";
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KiB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MiB`;
  };

  const readableAssetName = (asset: MediaAsset) => asset.originalName
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ");

  const syncRetainedAssets = () => {
    retainedAssetsInput.value = JSON.stringify([...assets.keys()]);
  };

  const renderCover = () => {
    const url = coverInput.value.trim();
    if (url) {
      coverImage.src = url;
      coverImage.alt = coverAltInput.value.trim() || "当前文章封面预览";
      coverImage.hidden = false;
      coverEmpty.hidden = true;
    } else {
      coverImage.removeAttribute("src");
      coverImage.alt = "";
      coverImage.hidden = true;
      coverEmpty.hidden = false;
    }
  };

  const emitChanged = () => {
    document.dispatchEvent(new CustomEvent("admin:post-media-changed", {
      detail: { ...context, assets: [...assets.values()] },
    }));
  };

  const addUsage = (asset: MediaAsset, usage: MediaAsset["usages"][number]) => {
    if (!asset.usages.includes(usage)) asset.usages = [...asset.usages, usage];
  };

  const removeUsage = (asset: MediaAsset, usage: MediaAsset["usages"][number]) => {
    asset.usages = asset.usages.filter((value) => value !== usage);
  };

  const setCover = (asset: MediaAsset) => {
    for (const current of assets.values()) removeUsage(current, "cover");
    addUsage(asset, "library");
    addUsage(asset, "cover");
    assets.set(asset.id, asset);
    coverAssetInput.value = asset.id;
    coverInput.value = asset.url;
    if (!coverAltInput.value.trim()) {
      coverAltInput.value = readableAssetName(asset);
    }
    syncRetainedAssets();
    renderCover();
    renderGallery();
    coverAltInput.focus();
    emitChanged();
  };

  const clearCover = () => {
    const current = assets.get(coverAssetInput.value);
    if (current) removeUsage(current, "cover");
    coverAssetInput.value = "";
    coverInput.value = "";
    coverAltInput.value = "";
    renderCover();
    renderGallery();
    emitChanged();
  };

  const removeAsset = async (asset: MediaAsset) => {
    setMediaStatus(`正在从本文移除 ${asset.originalName}…`, false, true);
    try {
      if (context.postId) {
        const response = await fetch(`/api/admin/posts/${context.postId}/assets/${asset.id}/`, {
          method: "DELETE",
        });
        const result = await response.json() as ApiResult<unknown>;
        if (!response.ok) throw new Error(messageFrom(result, "图片移除失败。"));
      }
      assets.delete(asset.id);
      if (coverAssetInput.value === asset.id) {
        coverAssetInput.value = "";
        coverInput.value = "";
        coverAltInput.value = "";
        renderCover();
      }
      syncRetainedAssets();
      renderGallery();
      setMediaStatus("");
      emitChanged();
    } catch (error) {
      setMediaStatus(error instanceof Error ? error.message : "图片移除失败。", true);
    }
  };

  function renderGallery() {
    mediaList.replaceChildren();
    mediaEmpty.hidden = assets.size > 0;
    for (const asset of assets.values()) {
      const card = document.createElement("article");
      card.className = "admin-post-media-card";

      const image = document.createElement("img");
      image.src = asset.url;
      image.alt = "";
      image.loading = "lazy";
      card.append(image);

      const body = document.createElement("div");
      body.className = "admin-post-media-card__body";
      const name = document.createElement("strong");
      name.textContent = asset.originalName;
      name.title = asset.originalName;
      const meta = document.createElement("span");
      meta.textContent = formatSize(asset.sizeBytes);
      body.append(name, meta);

      const badges = document.createElement("div");
      badges.className = "admin-post-media-card__badges";
      for (const usage of asset.usages) {
        const badge = document.createElement("span");
        badge.textContent = usageLabel(usage);
        badges.append(badge);
      }
      if (asset.sharedBy > 0) {
        const shared = document.createElement("span");
        shared.className = "admin-post-media-card__shared";
        shared.textContent = `被其他 ${asset.sharedBy} 篇文章使用`;
        badges.append(shared);
      }
      body.append(badges);

      const actions = document.createElement("div");
      actions.className = "admin-post-media-card__actions";
      const coverButton = document.createElement("button");
      coverButton.type = "button";
      coverButton.className = "admin-button admin-button--small";
      coverButton.textContent = coverAssetInput.value === asset.id ? "当前封面" : "设为封面";
      coverButton.disabled = coverAssetInput.value === asset.id;
      coverButton.addEventListener("click", () => setCover(asset));
      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "admin-button admin-button--small admin-button--danger";
      removeButton.textContent = "从本文移除";
      removeButton.addEventListener("click", () => void removeAsset(asset));
      actions.append(coverButton, removeButton);
      body.append(actions);
      card.append(body);
      mediaList.append(card);
    }
  }

  const insertMarkdown = (asset: MediaAsset) => {
    const start = bodyInput.selectionStart ?? bodyInput.value.length;
    const end = bodyInput.selectionEnd ?? start;
    const alt = readableAssetName(asset).replace(/([\\\[\]])/g, "\\$1");
    const before = bodyInput.value.slice(0, start);
    const after = bodyInput.value.slice(end);
    const prefix = before && !before.endsWith("\n") ? "\n" : "";
    const suffix = after && !after.startsWith("\n") ? "\n" : "";
    const markdown = `${prefix}![${alt}](${asset.url})${suffix}`;
    bodyInput.setRangeText(markdown, start, end, "end");
    addUsage(asset, "library");
    addUsage(asset, "inline");
    assets.set(asset.id, asset);
    syncRetainedAssets();
    renderGallery();
    bodyInput.focus();
    emitChanged();
  };

  const uploadFile = async (file: File) => {
    const uploadContext = { ...context };
    const uploadVersion = contextVersion;
    if (!uploadContext.postId && !uploadContext.draftToken) throw new Error("草稿标识尚未准备好，请重试。");
    const body = new FormData();
    body.append("file", file);
    body.append(
      uploadContext.postId ? "postId" : "draftToken",
      uploadContext.postId ?? uploadContext.draftToken,
    );
    const response = await fetch("/api/admin/post-assets/", { method: "POST", body });
    const result = await response.json() as ApiResult<{ asset: MediaAsset }>;
    if (!response.ok) throw new Error(messageFrom(result, `${file.name} 上传失败。`));
    const asset = result.data?.asset;
    if (!asset) throw new Error(`${file.name} 上传结果不完整。`);
    if (uploadVersion !== contextVersion) {
      throw new Error("文章已切换，刚上传的图片不会附加到当前文章。");
    }
    addUsage(asset, "library");
    assets.set(asset.id, asset);
    syncRetainedAssets();
    renderGallery();
    emitChanged();
    return asset;
  };

  const uploadCover = async (file?: File) => {
    if (!file) return;
    setMediaStatus(`正在上传封面 ${file.name}…`, false, true);
    try {
      setCover(await uploadFile(file));
      setMediaStatus("封面已上传，保存文章后生效。");
    } catch (error) {
      setMediaStatus(error instanceof Error ? error.message : "封面上传失败。", true);
    } finally {
      coverFileInput.value = "";
    }
  };

  const uploadInline = async (files: File[]) => {
    if (files.length === 0) return;
    try {
      for (const [index, file] of files.entries()) {
        setMediaStatus(`正在上传第 ${index + 1} / ${files.length} 张：${file.name}`, false, true);
        insertMarkdown(await uploadFile(file));
      }
      setMediaStatus(`已插入 ${files.length} 张图片，保存文章后生效。`);
    } catch (error) {
      setMediaStatus(error instanceof Error ? error.message : "正文图片上传失败。", true);
    } finally {
      inlineFileInput.value = "";
    }
  };

  const replaceAssets = (nextAssets: MediaAsset[]) => {
    assets.clear();
    for (const asset of nextAssets) assets.set(asset.id, asset);
    const cover = nextAssets.find(({ usages }) => usages.includes("cover"));
    coverAssetInput.value = cover?.id ?? "";
    if (cover) coverInput.value = cover.url;
    syncRetainedAssets();
    renderCover();
    renderGallery();
  };

  const refreshAssets = async (postId: string) => {
    const response = await fetch(`/api/admin/posts/${postId}/assets/`);
    const result = await response.json() as ApiResult<MediaAsset[]>;
    if (!response.ok) throw new Error(messageFrom(result, "文章图库读取失败。"));
    if (context.postId !== postId) return;
    replaceAssets(result.data ?? []);
  };

  const runBackfill = async () => {
    if (backfillStarted) return;
    backfillStarted = true;
    try {
      const response = await fetch("/api/admin/post-assets/backfill/", { method: "POST" });
      const result = await response.json() as ApiResult<{ registered: number; linked: number }>;
      if (!response.ok) throw new Error(messageFrom(result, "旧图片登记失败。"));
      if (context.postId && ((result.data?.registered ?? 0) > 0 || (result.data?.linked ?? 0) > 0)) {
        await refreshAssets(context.postId);
      }
    } catch (error) {
      setMediaStatus(error instanceof Error ? error.message : "旧图片登记失败。", true);
    }
  };

  document.addEventListener("admin:post-context", (event) => {
    const detail = (event as CustomEvent<PostContextDetail>).detail;
    contextVersion += 1;
    context = { ...(detail.postId ? { postId: detail.postId } : {}), draftToken: detail.draftToken };
    setMediaStatus("");
    if (detail.assets) {
      replaceAssets(detail.assets);
    } else if (detail.postId) {
      void refreshAssets(detail.postId).catch((error: unknown) => {
        setMediaStatus(error instanceof Error ? error.message : "文章图库读取失败。", true);
      });
    } else {
      replaceAssets([]);
    }
  });

  page.querySelector<HTMLButtonElement>("[data-post-cover-browse]")?.addEventListener("click", () => coverFileInput.click());
  page.querySelector<HTMLButtonElement>("[data-post-inline-browse]")?.addEventListener("click", () => inlineFileInput.click());
  page.querySelector<HTMLButtonElement>("[data-post-cover-remove]")?.addEventListener("click", clearCover);
  coverFileInput.addEventListener("change", () => void uploadCover(coverFileInput.files?.[0]));
  inlineFileInput.addEventListener("change", () => void uploadInline([...inlineFileInput.files ?? []]));
  coverAltInput.addEventListener("input", renderCover);

  for (const eventName of ["dragenter", "dragover"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.setAttribute("data-dragging", "");
    });
  }
  for (const eventName of ["dragleave", "drop"]) {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      dropzone.removeAttribute("data-dragging");
    });
  }
  dropzone.addEventListener("drop", (event) => void uploadCover(event.dataTransfer?.files[0]));

  renderCover();
  renderGallery();
  void runBackfill();
}

export {};
