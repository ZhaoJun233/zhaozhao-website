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

function initializeProgress(article: HTMLElement): void {
  const body = article.querySelector<HTMLElement>("[data-article-body]");
  const progress = document.querySelector<HTMLElement>("[data-reading-progress]");
  if (!body || !progress || article.dataset.progressReady === "true") return;
  article.dataset.progressReady = "true";

  let frame = 0;
  const update = (): void => {
    frame = 0;
    const start = body.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.22;
    const end = body.getBoundingClientRect().bottom + window.scrollY - window.innerHeight * 0.78;
    const range = Math.max(1, end - start);
    const value = Math.min(1, Math.max(0, (window.scrollY - start) / range));
    document.documentElement.style.setProperty("--reading-progress", value.toFixed(4));
    progress.setAttribute("aria-valuenow", String(Math.round(value * 100)));
  };

  const scheduleUpdate = (): void => {
    if (frame !== 0) return;
    frame = window.requestAnimationFrame(update);
  };

  update();
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate, { passive: true });
}

function initializeTableOfContents(article: HTMLElement): void {
  const links = [...article.querySelectorAll<HTMLAnchorElement>("[data-toc-link]")];
  const headings = [...new Set(
    links
      .map((link) => decodeURIComponent(link.hash.slice(1)))
      .map((id) => document.getElementById(id))
      .filter((heading): heading is HTMLElement => heading !== null),
  )];
  if (headings.length === 0 || article.dataset.tocReady === "true") return;
  article.dataset.tocReady = "true";

  const updateActiveLink = (): void => {
    const offset = window.innerHeight * 0.28;
    const active = headings.reduce<HTMLElement>((current, heading) => {
      return heading.getBoundingClientRect().top <= offset ? heading : current;
    }, headings[0]!);

    links.forEach((link) => {
      const isActive = decodeURIComponent(link.hash.slice(1)) === active.id;
      link.toggleAttribute("data-active", isActive);
      if (isActive) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
  };

  let frame = 0;
  const scheduleUpdate = (): void => {
    if (frame !== 0) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      updateActiveLink();
    });
  };

  updateActiveLink();
  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate, { passive: true });
}

function initializeArticle(): void {
  const article = document.querySelector<HTMLElement>("[data-article-root]");
  if (!article) return;
  initializeCodeCopy(article);
  initializeCopyLink(article);
  initializeProgress(article);
  initializeTableOfContents(article);
}

initializeArticle();
document.addEventListener("astro:page-load", initializeArticle);
