type MusicTrack = {
  id: string;
  title: string;
  artist: string;
  neteaseSongId: string;
  audioUrl?: string;
  coverAssetId?: string;
  coverUrl?: string;
  note?: string;
  enabled: boolean;
};

type ApiResult<T> = {
  data?: T;
  error?: string;
  fieldErrors?: Record<string, string[]>;
};

type UploadedAsset = { id: string; url: string };

type ImportedMusicMetadata = {
  title: string;
  artist: string;
  coverAssetId?: string;
  coverUrl?: string;
  warning?: string;
};

const page = document.querySelector<HTMLElement>("[data-music-page]");

if (page) {
  const recordsElement = page.querySelector<HTMLScriptElement>("[data-music-records]");
  const records = JSON.parse(recordsElement?.textContent ?? "[]") as MusicTrack[];
  const form = page.querySelector<HTMLFormElement>("[data-music-form]")!;
  const idInput = form.elements.namedItem("id") as HTMLInputElement;
  const draftTokenInput = form.elements.namedItem("draftToken") as HTMLInputElement;
  const coverAssetInput = form.elements.namedItem("coverAssetId") as HTMLInputElement;
  const coverFileInput = page.querySelector<HTMLInputElement>("[data-music-cover-input]")!;
  const coverImage = page.querySelector<HTMLImageElement>("[data-music-cover-preview] img")!;
  const coverEmpty = page.querySelector<HTMLElement>("[data-music-cover-empty]")!;
  const coverStatus = page.querySelector<HTMLElement>("[data-music-cover-status]")!;
  const metadataButton = page.querySelector<HTMLButtonElement>("[data-fetch-music-metadata]")!;
  const metadataStatus = page.querySelector<HTMLElement>("[data-music-metadata-status]")!;
  const status = page.querySelector<HTMLElement>("[data-music-status]")!;
  const editorTitle = page.querySelector<HTMLElement>("[data-music-editor-title]")!;
  let uploadPromise: Promise<void> | undefined;
  let previewObjectUrl: string | undefined;
  let formGeneration = 0;

  const messageFrom = (result: ApiResult<unknown>, fallback: string) => {
    const fields = Object.values(result.fieldErrors ?? {}).flat().filter(Boolean).join(" ");
    return fields || result.error || fallback;
  };

  const setStatus = (element: HTMLElement, message: string, error = false) => {
    element.textContent = message;
    element.toggleAttribute("data-error", error);
  };

  const input = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;

  const revokePreview = () => {
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = undefined;
  };

  const showCover = (url?: string) => {
    revokePreview();
    if (url) {
      coverImage.src = url;
      coverImage.hidden = false;
      coverEmpty.hidden = true;
    } else {
      coverImage.removeAttribute("src");
      coverImage.hidden = true;
      coverEmpty.hidden = false;
    }
  };

  const cleanupDraft = async (token: string) => {
    if (!token) return;
    const response = await fetch(`/api/admin/post-assets/drafts/${token}/`, { method: "DELETE" });
    const result = await response.json() as ApiResult<unknown>;
    if (!response.ok) throw new Error(messageFrom(result, "未保存封面清理失败。"));
  };

  const resetForm = async (clean = true) => {
    const oldToken = draftTokenInput.value;
    const oldUpload = uploadPromise;
    const resetGeneration = ++formGeneration;
    uploadPromise = undefined;
    form.reset();
    idInput.value = "";
    draftTokenInput.value = crypto.randomUUID();
    coverAssetInput.value = "";
    coverFileInput.value = "";
    coverFileInput.disabled = false;
    metadataButton.disabled = false;
    editorTitle.textContent = "新增歌曲";
    showCover();
    setStatus(status, "");
    setStatus(coverStatus, "");
    setStatus(metadataStatus, "");
    if (clean && oldToken) {
      if (oldUpload) await oldUpload.catch(() => undefined);
      await cleanupDraft(oldToken);
    }
    return resetGeneration;
  };

  const populate = async (track: MusicTrack) => {
    const populateGeneration = await resetForm();
    if (populateGeneration !== formGeneration) return;
    idInput.value = track.id;
    input("title").value = track.title;
    input("artist").value = track.artist;
    input("neteaseSongId").value = track.neteaseSongId;
    input("audioUrl").value = track.audioUrl ?? "";
    input("note").value = track.note ?? "";
    (input("enabled") as HTMLInputElement).checked = track.enabled;
    coverAssetInput.value = track.coverAssetId ?? "";
    showCover(track.coverUrl);
    editorTitle.textContent = `编辑：${track.title}`;
    input("title").focus();
  };

  const serialize = () => ({
    title: input("title").value.trim(),
    artist: input("artist").value.trim(),
    neteaseSongId: input("neteaseSongId").value.trim(),
    ...(input("audioUrl").value.trim() ? { audioUrl: input("audioUrl").value.trim() } : {}),
    ...(input("note").value.trim() ? { note: input("note").value.trim() } : {}),
    enabled: (input("enabled") as HTMLInputElement).checked,
    draftToken: draftTokenInput.value,
    ...(coverAssetInput.value ? { coverAssetId: coverAssetInput.value } : {}),
  });

  page.querySelector<HTMLElement>("[data-create-music]")?.addEventListener("click", () => {
    void resetForm().then(() => input("title").focus()).catch((error: unknown) => {
      setStatus(status, error instanceof Error ? error.message : "新建歌曲失败。", true);
    });
  });

  page.querySelector<HTMLElement>("[data-cancel-music]")?.addEventListener("click", () => {
    void resetForm().catch((error: unknown) => {
      setStatus(status, error instanceof Error ? error.message : "清理编辑内容失败。", true);
    });
  });

  page.querySelector<HTMLElement>("[data-remove-music-cover]")?.addEventListener("click", () => {
    coverAssetInput.value = "";
    coverFileInput.value = "";
    showCover();
    setStatus(coverStatus, "封面将在保存后移除。");
  });

  coverFileInput.addEventListener("change", () => {
    const file = coverFileInput.files?.[0];
    if (!file) return;
    revokePreview();
    previewObjectUrl = URL.createObjectURL(file);
    coverImage.src = previewObjectUrl;
    coverImage.hidden = false;
    coverEmpty.hidden = true;
    setStatus(coverStatus, "正在上传封面…");
    coverFileInput.disabled = true;
    const uploadToken = draftTokenInput.value;
    const uploadGeneration = formGeneration;
    const isCurrentUpload = () => (
      uploadGeneration === formGeneration && draftTokenInput.value === uploadToken
    );
    const body = new FormData();
    body.set("file", file);
    body.set("draftToken", uploadToken);
    uploadPromise = fetch("/api/admin/music/assets/", { method: "POST", body })
      .then(async (response) => {
        const result = await response.json() as ApiResult<{ asset: UploadedAsset }>;
        if (!response.ok || !result.data?.asset) {
          throw new Error(messageFrom(result, "封面上传失败。"));
        }
        if (!isCurrentUpload()) return;
        coverAssetInput.value = result.data.asset.id;
        showCover(result.data.asset.url);
        setStatus(coverStatus, "封面已上传，保存歌曲后正式关联。");
      })
      .catch((error: unknown) => {
        if (isCurrentUpload()) {
          coverAssetInput.value = "";
          setStatus(coverStatus, error instanceof Error ? error.message : "封面上传失败。", true);
        }
        throw error;
      })
      .finally(() => {
        if (isCurrentUpload()) {
          coverFileInput.disabled = false;
          uploadPromise = undefined;
        }
      });
  });

  metadataButton.addEventListener("click", () => {
    const songIdInput = input("neteaseSongId") as HTMLInputElement;
    if (!songIdInput.checkValidity()) {
      songIdInput.reportValidity();
      setStatus(metadataStatus, "请先填写有效的网易云歌曲 ID。", true);
      return;
    }
    const requestedGeneration = formGeneration;
    const requestedDraftToken = draftTokenInput.value;
    const isCurrentRequest = () => (
      requestedGeneration === formGeneration
      && requestedDraftToken === draftTokenInput.value
    );
    metadataButton.disabled = true;
    setStatus(metadataStatus, "正在获取歌曲信息…");

    void (async () => {
      try {
        const response = await fetch("/api/admin/music/metadata/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            neteaseSongId: songIdInput.value.trim(),
            draftToken: requestedDraftToken,
          }),
        });
        const result = await response.json() as ApiResult<ImportedMusicMetadata>;
        if (!response.ok || !result.data) {
          throw new Error(messageFrom(result, "歌曲信息获取失败。"));
        }
        if (!isCurrentRequest()) {
          await cleanupDraft(requestedDraftToken).catch(() => undefined);
          return;
        }
        input("title").value = result.data.title;
        input("artist").value = result.data.artist;
        if (result.data.coverAssetId && result.data.coverUrl) {
          coverAssetInput.value = result.data.coverAssetId;
          coverFileInput.value = "";
          showCover(result.data.coverUrl);
          setStatus(coverStatus, "封面已获取，保存歌曲后正式关联。");
        }
        setStatus(metadataStatus, result.data.warning ?? "歌曲信息已获取。");
      } catch (error) {
        if (!isCurrentRequest()) {
          await cleanupDraft(requestedDraftToken).catch(() => undefined);
          return;
        }
        setStatus(
          metadataStatus,
          error instanceof Error ? error.message : "歌曲信息获取失败。",
          true,
        );
      } finally {
        if (isCurrentRequest()) metadataButton.disabled = false;
      }
    })();
  });

  page.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const edit = target.closest<HTMLButtonElement>("[data-edit-music]");
    const remove = target.closest<HTMLButtonElement>("[data-delete-music]");
    const move = target.closest<HTMLButtonElement>("[data-move-music]");

    if (edit?.dataset.editMusic) {
      const track = records.find(({ id }) => id === edit.dataset.editMusic);
      if (track) void populate(track).catch((error: unknown) => {
        setStatus(status, error instanceof Error ? error.message : "歌曲读取失败。", true);
      });
    }

    if (remove?.dataset.deleteMusic) {
      const track = records.find(({ id }) => id === remove.dataset.deleteMusic);
      if (!track || !window.confirm(`确定删除歌曲“${track.title}”吗？`)) return;
      remove.disabled = true;
      void fetch(`/api/admin/music/${track.id}/`, { method: "DELETE" })
        .then(async (response) => {
          const result = await response.json() as ApiResult<unknown>;
          if (!response.ok) throw new Error(messageFrom(result, "删除歌曲失败。"));
          window.location.reload();
        })
        .catch((error: unknown) => {
          remove.disabled = false;
          setStatus(status, error instanceof Error ? error.message : "删除歌曲失败。", true);
        });
    }

    if (move?.dataset.moveMusic) {
      const rows = [...page.querySelectorAll<HTMLTableRowElement>("[data-music-row]")];
      const current = rows.findIndex((row) => row.dataset.recordId === move.dataset.moveMusic);
      const next = move.dataset.direction === "up" ? current - 1 : current + 1;
      if (current < 0 || next < 0 || next >= rows.length) return;
      const reordered = [...rows];
      [reordered[current], reordered[next]] = [reordered[next], reordered[current]];
      move.disabled = true;
      void fetch("/api/admin/music/order/", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: reordered.map((row) => row.dataset.recordId) }),
      }).then(async (response) => {
        const result = await response.json() as ApiResult<unknown>;
        if (!response.ok) throw new Error(messageFrom(result, "歌曲排序失败。"));
        const body = page.querySelector<HTMLTableSectionElement>("[data-music-rows]")!;
        reordered.forEach((row) => body.append(row));
      }).catch((error: unknown) => {
        setStatus(status, error instanceof Error ? error.message : "歌曲排序失败。", true);
      }).finally(() => {
        move.disabled = false;
      });
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>("button[type='submit']")!;
    submit.disabled = true;
    setStatus(status, uploadPromise ? "正在等待封面上传完成…" : "正在保存歌曲…");
    void (async () => {
      if (uploadPromise) await uploadPromise;
      const id = idInput.value;
      const response = await fetch(id ? `/api/admin/music/${id}/` : "/api/admin/music/", {
        method: id ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(serialize()),
      });
      const result = await response.json() as ApiResult<unknown>;
      if (!response.ok) throw new Error(messageFrom(result, "歌曲保存失败。"));
      await cleanupDraft(draftTokenInput.value);
      setStatus(status, "已保存，正在刷新…");
      window.location.reload();
    })().catch((error: unknown) => {
      submit.disabled = false;
      setStatus(status, error instanceof Error ? error.message : "歌曲保存失败。", true);
    });
  });

  void resetForm(false);
}

export {};
