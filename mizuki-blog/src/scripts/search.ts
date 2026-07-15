type PagefindFilterValue = string | string[] | { any: string[] };
type PagefindFilters = Record<string, PagefindFilterValue>;

type PagefindResultData = {
  url: string;
  excerpt?: string;
  meta?: Record<string, string>;
  filters?: Record<string, string | string[]>;
};

type PagefindResult = {
  data: () => Promise<PagefindResultData>;
};

type PagefindSearchResponse = {
  results: PagefindResult[];
};

type PagefindModule = {
  search: (
    query: string | null,
    options?: { filters?: PagefindFilters },
  ) => Promise<PagefindSearchResponse>;
};

type SearchResultView = {
  title: string;
  excerpt: string;
  url: string;
  category: string;
  tags: string[];
};

const PAGEFIND_PATH = "/pagefind/pagefind.js";
const SEARCH_DEBOUNCE_MS = 120;
const MAX_RESULTS = 24;
let pagefindPromise: Promise<PagefindModule> | undefined;

function loadPagefind(): Promise<PagefindModule> {
  if (!pagefindPromise) {
    pagefindPromise = import(/* @vite-ignore */ PAGEFIND_PATH) as Promise<PagefindModule>;
    void pagefindPromise.catch(() => undefined);
  }
  return pagefindPromise;
}

function valuesOf(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function mapResult(data: PagefindResultData): SearchResultView {
  const category = valuesOf(data.filters?.category)[0] ?? "";

  return {
    title: data.meta?.title?.trim() || data.url,
    excerpt: data.excerpt?.trim() || data.meta?.description?.trim() || "",
    url: data.url,
    category,
    tags: valuesOf(data.filters?.tag),
  };
}

function appendSafeExcerpt(target: HTMLElement, source: string): void {
  const template = document.createElement("template");
  template.innerHTML = source;

  const appendNode = (node: Node, parent: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(node.cloneNode());
      return;
    }

    if (!(node instanceof HTMLElement)) return;

    const nextParent = node.tagName === "MARK" ? document.createElement("mark") : parent;
    if (nextParent !== parent) parent.appendChild(nextParent);
    for (const child of node.childNodes) appendNode(child, nextParent);
  };

  for (const child of template.content.childNodes) appendNode(child, target);
}

function createResultItem(result: SearchResultView): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "search-result";

  const link = document.createElement("a");
  link.className = "search-result__link";
  link.href = result.url;
  link.dataset.searchResultLink = "";

  const heading = document.createElement("div");
  heading.className = "search-result__heading";

  const title = document.createElement("h2");
  title.className = "search-result__title";
  title.textContent = result.title;
  heading.append(title);

  if (result.category) {
    const category = document.createElement("span");
    category.className = "search-result__category";
    category.textContent = result.category;
    heading.append(category);
  }

  link.append(heading);

  if (result.excerpt) {
    const excerpt = document.createElement("p");
    excerpt.className = "search-result__excerpt";
    appendSafeExcerpt(excerpt, result.excerpt);
    link.append(excerpt);
  }

  if (result.tags.length > 0) {
    const tags = document.createElement("p");
    tags.className = "search-result__tags";
    tags.textContent = result.tags.map((tag) => `#${tag}`).join("  ");
    link.append(tags);
  }

  item.append(link);
  return item;
}

class SearchController {
  readonly root: HTMLElement;
  readonly form: HTMLFormElement;
  readonly input: HTMLInputElement;
  readonly category: HTMLSelectElement;
  readonly tagInputs: HTMLInputElement[];
  readonly status: HTMLElement;
  readonly indexNotice: HTMLElement;
  readonly results: HTMLOListElement;
  readonly empty: HTMLElement;
  readonly emptyTitle: HTMLElement;
  readonly emptyMessage: HTMLElement;
  requestId = 0;
  debounceTimer = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.form = this.find("[data-search-form]");
    this.input = this.find("[data-search-input]");
    this.category = this.find("[data-search-category]");
    this.tagInputs = Array.from(root.querySelectorAll<HTMLInputElement>("[data-search-tag]"));
    this.status = this.find("[data-search-status]");
    this.indexNotice = this.find("[data-search-index-notice]");
    this.results = this.find("[data-search-results]");
    this.empty = this.find("[data-search-empty]");
    this.emptyTitle = this.find("[data-search-empty-title]");
    this.emptyMessage = this.find("[data-search-empty-message]");
    this.bind();
  }

  private find<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing search element: ${selector}`);
    return element;
  }

  private bind(): void {
    this.input.addEventListener("input", () => this.scheduleSearch());
    this.category.addEventListener("change", () => this.scheduleSearch());
    for (const input of this.tagInputs) {
      input.addEventListener("change", () => this.scheduleSearch());
    }

    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      const firstResult = this.results.querySelector<HTMLElement>("[data-search-result-link]");
      firstResult?.focus();
    });

    this.form.addEventListener("reset", () => {
      window.requestAnimationFrame(() => this.renderIdle());
    });

    this.root.addEventListener("keydown", (event) => this.handleArrowKeys(event));
  }

  private currentFilters(): PagefindFilters {
    const filters: PagefindFilters = {};
    const category = this.category.value;
    const tags = this.tagInputs.filter((input) => input.checked).map((input) => input.value);

    if (category) filters.category = category;
    if (tags.length > 0) filters.tag = { any: tags };
    return filters;
  }

  private scheduleSearch(): void {
    const query = this.input.value.trim();
    const filters = this.currentFilters();
    const hasFilters = Object.keys(filters).length > 0;
    const requestId = ++this.requestId;
    window.clearTimeout(this.debounceTimer);

    if (!query && !hasFilters) {
      this.renderIdle();
      return;
    }

    const module = loadPagefind();
    this.root.setAttribute("aria-busy", "true");
    this.indexNotice.hidden = true;
    this.empty.hidden = true;
    this.status.textContent = "正在搜索";

    this.debounceTimer = window.setTimeout(() => {
      void this.performSearch(module, requestId, query, filters);
    }, SEARCH_DEBOUNCE_MS);
  }

  private async performSearch(
    modulePromise: Promise<PagefindModule>,
    requestId: number,
    query: string,
    filters: PagefindFilters,
  ): Promise<void> {
    try {
      const pagefind = await modulePromise;
      const response = await pagefind.search(query || null, { filters });
      const data = await Promise.all(
        response.results.slice(0, MAX_RESULTS).map(async (result) => mapResult(await result.data())),
      );

      if (requestId !== this.requestId) return;
      this.renderResults(data);
    } catch (error) {
      if (requestId !== this.requestId) return;
      console.warn("Pagefind search is unavailable", error);
      this.renderError();
    }
  }

  private renderResults(results: SearchResultView[]): void {
    this.root.setAttribute("aria-busy", "false");
    this.indexNotice.hidden = true;
    this.results.replaceChildren(...results.map(createResultItem));
    this.status.textContent = `找到 ${results.length} 条结果`;
    this.empty.hidden = results.length > 0;
    this.emptyTitle.textContent = results.length === 0 ? "没有找到匹配的内容" : "";
    this.emptyMessage.textContent = results.length === 0
      ? "换个关键词，或减少筛选条件再试试。"
      : "";
  }

  private renderIdle(): void {
    ++this.requestId;
    window.clearTimeout(this.debounceTimer);
    this.root.setAttribute("aria-busy", "false");
    this.results.replaceChildren();
    this.empty.hidden = true;
    this.emptyTitle.textContent = "";
    this.emptyMessage.textContent = "";
    this.indexNotice.hidden = true;
    this.status.textContent = "输入关键词，或选择分类与标签开始搜索";
  }

  private renderError(): void {
    this.root.setAttribute("aria-busy", "false");
    this.results.replaceChildren();
    this.empty.hidden = true;
    this.emptyTitle.textContent = "";
    this.emptyMessage.textContent = "";

    if (import.meta.env.DEV) {
      this.indexNotice.hidden = false;
      this.status.textContent = "搜索索引尚未生成";
    } else {
      this.indexNotice.hidden = true;
      this.status.textContent = "搜索暂时不可用，请稍后再试";
    }
  }

  private handleArrowKeys(event: KeyboardEvent): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

    const links = Array.from(
      this.results.querySelectorAll<HTMLElement>("[data-search-result-link]"),
    );
    if (links.length === 0) return;

    const target = event.target;
    if (target === this.input) {
      event.preventDefault();
      (event.key === "ArrowDown" ? links[0] : links.at(-1))?.focus();
      return;
    }

    if (!(target instanceof HTMLElement)) return;
    const index = links.indexOf(target);
    if (index < 0) return;

    event.preventDefault();
    if (event.key === "ArrowDown") {
      links[(index + 1) % links.length]?.focus();
    } else if (index === 0) {
      this.input.focus();
    } else {
      links[index - 1]?.focus();
    }
  }
}

function initializeSearchControllers(): void {
  for (const root of document.querySelectorAll<HTMLElement>("[data-pagefind-search]")) {
    if (root.dataset.searchReady === "true") continue;
    root.dataset.searchReady = "true";
    new SearchController(root);
  }
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest("input, textarea, select")) return true;
  return target.closest('[contenteditable]:not([contenteditable="false"])') !== null;
}

function focusableElements(dialog: HTMLDialogElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

function initializeSearchDialog(): void {
  const dialog = document.querySelector<HTMLDialogElement>("[data-search-dialog]");
  if (!dialog || dialog.dataset.searchDialogReady === "true") return;
  dialog.dataset.searchDialogReady = "true";

  const input = dialog.querySelector<HTMLInputElement>("[data-search-input]");
  let lastOpener: HTMLElement | null = null;
  let pointerStartedOnBackdrop = false;

  const openDialog = (opener: HTMLElement) => {
    lastOpener = opener;
    if (!dialog.open) dialog.showModal();
    window.requestAnimationFrame(() => input?.focus());
  };

  const closeDialog = () => {
    if (dialog.open) dialog.close();
  };

  for (const opener of document.querySelectorAll<HTMLElement>("[data-search-open]")) {
    if (opener.dataset.searchOpenerReady === "true") continue;
    opener.dataset.searchOpenerReady = "true";
    opener.addEventListener("click", (event) => {
      event.preventDefault();
      openDialog(opener);
    });
  }

  for (const closer of dialog.querySelectorAll<HTMLElement>("[data-search-close]")) {
    closer.addEventListener("click", closeDialog);
  }

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog();
  });

  dialog.addEventListener("close", () => {
    const opener = lastOpener;
    lastOpener = null;
    window.requestAnimationFrame(() => opener?.focus({ preventScroll: true }));
  });

  dialog.addEventListener("pointerdown", (event) => {
    pointerStartedOnBackdrop = event.target === dialog;
  });

  dialog.addEventListener("click", (event) => {
    if (pointerStartedOnBackdrop && event.target === dialog) closeDialog();
    pointerStartedOnBackdrop = false;
  });

  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const focusable = focusableElements(dialog);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  if (document.documentElement.dataset.searchShortcutReady !== "true") {
    document.documentElement.dataset.searchShortcutReady = "true";
    document.addEventListener("keydown", (event) => {
      if (
        event.key !== "/" ||
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      const opener = document.querySelector<HTMLElement>("[data-search-open]");
      if (!opener) return;
      event.preventDefault();
      openDialog(opener);
    });
  }
}

function initializeSearch(): void {
  initializeSearchControllers();
  initializeSearchDialog();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeSearch, { once: true });
} else {
  initializeSearch();
}

document.addEventListener("astro:page-load", initializeSearch);
