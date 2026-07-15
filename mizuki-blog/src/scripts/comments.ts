type GiscusRoot = HTMLElement & {
  dataset: DOMStringMap & {
    repo?: string;
    repoId?: string;
    category?: string;
    categoryId?: string;
    term?: string;
  };
};

function resolvedTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function loadGiscus(root: GiscusRoot): void {
  if (root.dataset.giscusLoaded === "true") return;
  const { repo, repoId, category, categoryId, term } = root.dataset;
  if (!repo || !repoId || !category || !categoryId) return;
  root.dataset.giscusLoaded = "true";

  root.querySelector("[data-giscus-status]")?.remove();
  const script = document.createElement("script");
  script.src = "https://giscus.app/client.js";
  script.async = true;
  script.crossOrigin = "anonymous";
  script.setAttribute("data-repo", repo);
  script.setAttribute("data-repo-id", repoId);
  script.setAttribute("data-category", category);
  script.setAttribute("data-category-id", categoryId);
  script.setAttribute("data-mapping", term ? "specific" : "pathname");
  if (term) script.setAttribute("data-term", term);
  script.setAttribute("data-strict", "0");
  script.setAttribute("data-reactions-enabled", "1");
  script.setAttribute("data-emit-metadata", "0");
  script.setAttribute("data-input-position", "top");
  script.setAttribute("data-theme", resolvedTheme());
  script.setAttribute("data-lang", "zh-CN");
  script.setAttribute("data-loading", "lazy");
  root.append(script);
}

function initializeComments(): void {
  document.querySelectorAll<GiscusRoot>("[data-giscus-root]").forEach((root) => {
    if (root.dataset.giscusObserved === "true") return;
    root.dataset.giscusObserved = "true";

    if (!("IntersectionObserver" in window)) {
      loadGiscus(root);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        loadGiscus(root);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(root);
  });
}

initializeComments();
document.addEventListener("astro:page-load", initializeComments);
