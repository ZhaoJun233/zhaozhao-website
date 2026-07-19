type ClipboardResult = "copied" | "failed";

async function copyText(value: string): Promise<ClipboardResult> {
  try {
    await navigator.clipboard.writeText(value);
    return "copied";
  } catch {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();

    try {
      const legacyDocument = document as unknown as {
        execCommand(commandId: string): boolean;
      };
      return legacyDocument.execCommand("copy") ? "copied" : "failed";
    } finally {
      input.remove();
    }
  }
}

function announce(message: string): void {
  const region = document.querySelector<HTMLElement>("[data-article-announcer]");
  if (!region) return;
  region.textContent = "";
  window.setTimeout(() => {
    region.textContent = message;
  }, 20);
}

function initializeCodeCopy(article: HTMLElement): void {
  article.querySelectorAll<HTMLPreElement>("pre").forEach((block) => {
    if (block.dataset.copyReady === "true") return;
    block.dataset.copyReady = "true";

    const code = block.querySelector<HTMLElement>("code");
    if (!code) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy-button";
    button.textContent = "复制代码";
    button.setAttribute("aria-label", "复制代码");

    button.addEventListener("click", async () => {
      const result = await copyText(code.textContent ?? "");
      const message = result === "copied" ? "已复制" : "复制失败";
      button.textContent = message;
      announce(result === "copied" ? "代码已复制到剪贴板" : "代码复制失败");

      window.setTimeout(() => {
        button.textContent = "复制代码";
      }, 1800);
    });

    block.prepend(button);
  });
}

function initializeCopyLink(article: HTMLElement): void {
  const button = article.querySelector<HTMLButtonElement>("[data-copy-link]");
  if (!button || button.dataset.copyReady === "true") return;
  button.dataset.copyReady = "true";

  const label = button.querySelector<HTMLElement>("[data-copy-link-label]");
  button.addEventListener("click", async () => {
    const result = await copyText(window.location.href);
    const message = result === "copied" ? "链接已复制" : "复制失败";
    if (label) label.textContent = message;
    announce(result === "copied" ? "文章链接已复制到剪贴板" : "文章链接复制失败");

    window.setTimeout(() => {
      if (label) label.textContent = "复制文章链接";
    }, 1800);
  });
}

function initializeProgress(article: HTMLElement, signal: AbortSignal): () => void {
  const body = article.querySelector<HTMLElement>("[data-article-body]");
  const progress = document.querySelector<HTMLElement>("[data-reading-progress]");
  if (!body || !progress) return () => undefined;

  let frame = 0;
  let start = 0;
  let end = 1;
  let lastValue = "";
  let lastPercent = "";
  const measure = (): void => {
    const bounds = body.getBoundingClientRect();
    start = bounds.top + window.scrollY - window.innerHeight * 0.22;
    end = bounds.bottom + window.scrollY - window.innerHeight * 0.78;
  };
  const update = (): void => {
    frame = 0;
    const range = Math.max(1, end - start);
    const value = Math.min(1, Math.max(0, (window.scrollY - start) / range));
    const nextValue = value.toFixed(4);
    const nextPercent = String(Math.round(value * 100));
    if (nextValue !== lastValue) {
      document.documentElement.style.setProperty("--reading-progress", nextValue);
      lastValue = nextValue;
    }
    if (nextPercent !== lastPercent) {
      progress.setAttribute("aria-valuenow", nextPercent);
      lastPercent = nextPercent;
    }
  };

  const scheduleUpdate = (): void => {
    if (signal.aborted || frame !== 0) return;
    frame = window.requestAnimationFrame(update);
  };

  const measureAndUpdate = (): void => {
    measure();
    scheduleUpdate();
  };

  measure();
  update();
  window.addEventListener("scroll", scheduleUpdate, { passive: true, signal });
  window.addEventListener("resize", measureAndUpdate, { passive: true, signal });
  const observer = new ResizeObserver(measureAndUpdate);
  observer.observe(body);
  return () => {
    observer.disconnect();
    if (frame !== 0) window.cancelAnimationFrame(frame);
  };
}

function initializeTableOfContents(article: HTMLElement, signal: AbortSignal): () => void {
  const links = [...article.querySelectorAll<HTMLAnchorElement>("[data-toc-link]")];
  const headings = [...new Set(
    links
      .map((link) => decodeURIComponent(link.hash.slice(1)))
      .map((id) => document.getElementById(id))
      .filter((heading): heading is HTMLElement => heading !== null),
  )];
  if (headings.length === 0) return () => undefined;

  let headingOffsets: Array<{ id: string; top: number }> = [];
  let activeId = "";
  const measureHeadings = (): void => {
    headingOffsets = headings.map((heading) => ({
      id: heading.id,
      top: heading.getBoundingClientRect().top + window.scrollY,
    }));
  };

  const updateActiveLink = (): void => {
    const offset = window.scrollY + window.innerHeight * 0.28;
    const active = headingOffsets.reduce((current, heading) => (
      heading.top <= offset ? heading : current
    ), headingOffsets[0]!);
    if (active.id === activeId) return;
    activeId = active.id;

    links.forEach((link) => {
      const isActive = decodeURIComponent(link.hash.slice(1)) === activeId;
      link.toggleAttribute("data-active", isActive);
      if (isActive) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  };

  let frame = 0;
  const scheduleUpdate = (): void => {
    if (signal.aborted || frame !== 0) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      updateActiveLink();
    });
  };

  const measureAndUpdate = (): void => {
    measureHeadings();
    activeId = "";
    scheduleUpdate();
  };

  measureHeadings();
  updateActiveLink();
  window.addEventListener("scroll", scheduleUpdate, { passive: true, signal });
  window.addEventListener("resize", measureAndUpdate, { passive: true, signal });
  const observer = new ResizeObserver(measureAndUpdate);
  observer.observe(article);
  return () => {
    observer.disconnect();
    if (frame !== 0) window.cancelAnimationFrame(frame);
  };
}

let activeArticle: HTMLElement | undefined;
let cleanupActiveArticle: (() => void) | undefined;

function initializeArticle(): void {
  const article = document.querySelector<HTMLElement>("[data-article-root]");
  if (article && article === activeArticle) return;
  cleanupActiveArticle?.();
  activeArticle = article ?? undefined;
  if (!article) return;
  const controller = new AbortController();
  initializeCodeCopy(article);
  initializeCopyLink(article);
  const cleanupProgress = initializeProgress(article, controller.signal);
  const cleanupTableOfContents = initializeTableOfContents(article, controller.signal);
  cleanupActiveArticle = () => {
    controller.abort();
    cleanupProgress();
    cleanupTableOfContents();
    if (activeArticle === article) activeArticle = undefined;
    cleanupActiveArticle = undefined;
  };
}

initializeArticle();
document.addEventListener("astro:page-load", initializeArticle);
document.addEventListener("astro:before-swap", () => cleanupActiveArticle?.());
