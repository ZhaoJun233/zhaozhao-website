type JsonObject = Record<string, unknown>;

const editor = document.querySelector<HTMLElement>("[data-setting-editor]");
const form = document.querySelector<HTMLFormElement>("[data-setting-form]");
const status = document.querySelector<HTMLElement>("[data-setting-status]");
const tabs = [...document.querySelectorAll<HTMLButtonElement>("[data-setting-key]")];
let activeKey = tabs[0]?.dataset.settingKey ?? "profile";
let activeValue: unknown;

const fieldLabels: Record<string, string> = {
  name: "昵称",
  siteTitle: "站点副标题",
  description: "站点简介",
  bio: "个人简介",
  avatar: "头像路径",
  occupation: "职业 / 身份",
  location: "所在地",
  motto: "个性签名",
  email: "联系邮箱",
  website: "个人网站",
  seoDescription: "搜索摘要",
  eyebrow: "英文眉题",
  title: "标题",
  weatherNotes: "天气寄语",
  music: "音乐文案",
  clear: "晴朗",
  cloudy: "多云",
  rain: "下雨",
  snow: "下雪",
  storm: "雷暴",
  fallback: "不可用时",
  emptyTitle: "空状态标题",
  emptyDescription: "空状态说明",
  openLabel: "网易云外链文字",
};

function titleFor(key: string) {
  return fieldLabels[key] ?? key.replaceAll("_", " ");
}

function controlIdFor(path: Array<string | number>) {
  const safePath = path.map((segment) => {
    const value = String(segment);
    const safeValue = value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "field";
    return `${typeof segment === "number" ? "number" : "string"}-${value.length}-${safeValue}`;
  }).join("--");
  return `admin-setting-${safePath}`;
}

function addMediaUpload(wrapper: HTMLElement, control: HTMLInputElement | HTMLTextAreaElement) {
  const upload = document.createElement("div");
  upload.className = "admin-media-upload";
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/jpeg,image/png,image/webp,image/gif";
  input.setAttribute("aria-label", "上传并填入图片路径");
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file || !status) return;
    const body = new FormData();
    body.set("file", file);
    status.textContent = "正在上传图片…";
    status.removeAttribute("data-error");
    try {
      const response = await fetch("/api/admin/media/", { method: "POST", body });
      const result = await response.json() as {
        data?: { url?: string };
        error?: string;
      };
      if (!response.ok || !result.data?.url) throw new Error(result.error ?? "上传失败。");
      control.value = result.data.url;
      status.textContent = "图片已上传，保存设置后前台生效。";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : "上传失败。";
      status.setAttribute("data-error", "");
    } finally {
      input.value = "";
    }
  });
  upload.append(input);
  wrapper.append(upload);
}

function createControl(value: unknown, path: Array<string | number>): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "admin-field";
  const fieldName = String(path.at(-1));
  wrapper.dataset.settingField = fieldName;
  const pathValue = JSON.stringify(path);
  if (typeof value === "boolean") {
    const label = document.createElement("label");
    label.className = "admin-field--check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = value;
    input.dataset.settingPath = pathValue;
    input.dataset.valueKind = "boolean";
    label.append(input, document.createTextNode(titleFor(String(path.at(-1)))));
    wrapper.append(label);
    return wrapper;
  }

  const label = document.createElement("label");
  label.textContent = titleFor(String(path.at(-1)));
  const complexArray = Array.isArray(value) && value.some((item) => typeof item === "object");
  const longText = typeof value === "string" && (
    value.length > 80 || value.includes("\n") || ["description", "bio", "motto"].includes(fieldName)
  );
  const array = Array.isArray(value);
  const control = complexArray || longText || array
    ? document.createElement("textarea")
    : document.createElement("input");
  const controlId = controlIdFor(path);
  control.id = controlId;
  label.htmlFor = controlId;
  control.dataset.settingPath = pathValue;
  control.dataset.valueKind = complexArray ? "json" : array ? "lines" : typeof value;
  control.value = complexArray
    ? JSON.stringify(value, null, 2)
    : array ? value.join("\n") : String(value ?? "");
  if (control instanceof HTMLInputElement) {
    if (fieldName === "email") control.type = "email";
    if (fieldName === "website") control.type = "url";
  }
  if (complexArray) control.style.minBlockSize = "12rem";
  wrapper.append(label, control);
  if (["avatar", "image"].includes(fieldName)) addMediaUpload(wrapper, control);
  return wrapper;
}

function renderObject(value: JsonObject, path: Array<string | number> = []): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const [key, item] of Object.entries(value)) {
    const nextPath = [...path, key];
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const fieldset = document.createElement("fieldset");
      fieldset.className = "admin-setting-group";
      const legend = document.createElement("legend");
      legend.textContent = titleFor(key);
      fieldset.append(legend, renderObject(item as JsonObject, nextPath));
      fragment.append(fieldset);
    } else {
      fragment.append(createControl(item, nextPath));
    }
  }
  return fragment;
}

function setAtPath(target: unknown, path: Array<string | number>, value: unknown) {
  let cursor = target as Record<string | number, unknown>;
  for (const segment of path.slice(0, -1)) cursor = cursor[segment] as Record<string | number, unknown>;
  cursor[path.at(-1)!] = value;
}

async function loadSetting(key: string) {
  if (!editor || !status) return;
  status.textContent = "正在读取…";
  status.removeAttribute("data-error");
  const response = await fetch(`/api/admin/settings/${key}/`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "读取设置失败。");
  activeKey = key;
  activeValue = result.data;
  editor.dataset.settingKey = key;
  editor.replaceChildren(renderObject(result.data));
  tabs.forEach((tab) => tab.setAttribute("aria-pressed", String(tab.dataset.settingKey === key)));
  status.textContent = "";
}

tabs.forEach((tab) => tab.addEventListener("click", () => {
  loadSetting(tab.dataset.settingKey!).catch((error) => {
    if (status) { status.textContent = error instanceof Error ? error.message : "读取失败。"; status.setAttribute("data-error", ""); }
  });
}));

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!editor || !status) return;
  const next = structuredClone(activeValue);
  try {
    for (const control of editor.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-setting-path]")) {
      const path = JSON.parse(control.dataset.settingPath!) as Array<string | number>;
      const kind = control.dataset.valueKind;
      let value: unknown = control.value;
      if (kind === "boolean" && control instanceof HTMLInputElement) value = control.checked;
      if (kind === "number") value = Number(control.value);
      if (kind === "lines") value = control.value.split("\n").map((line) => line.trim()).filter(Boolean);
      if (kind === "json") value = JSON.parse(control.value);
      setAtPath(next, path, value);
    }
    status.textContent = "正在保存…";
    status.removeAttribute("data-error");
    const response = await fetch(`/api/admin/settings/${activeKey}/`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "保存失败。");
    activeValue = result.data;
    status.textContent = "已保存，前台刷新后立即生效。";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "保存失败。";
    status.setAttribute("data-error", "");
  }
});

loadSetting(activeKey).catch((error) => {
  if (status) { status.textContent = error instanceof Error ? error.message : "读取失败。"; status.setAttribute("data-error", ""); }
});

export {};
