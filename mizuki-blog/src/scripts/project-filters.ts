type ProjectFilter = "all" | "active" | "completed" | "archived";

function initializeProjectFilters(): void {
  document.querySelectorAll<HTMLElement>("[data-project-browser]").forEach((browser) => {
    if (browser.dataset.projectFiltersReady === "true") return;
    browser.dataset.projectFiltersReady = "true";

    const buttons = [...browser.querySelectorAll<HTMLButtonElement>("[data-project-filter]")];
    const cards = [...browser.querySelectorAll<HTMLElement>("[data-project-card]")];
    const count = browser.querySelector<HTMLElement>("[data-project-result-count]");
    const empty = browser.querySelector<HTMLElement>("[data-project-empty]");

    const applyFilter = (filter: ProjectFilter): void => {
      let visibleCount = 0;

      for (const card of cards) {
        const visible = filter === "all" || card.dataset.projectStatus === filter;
        card.hidden = !visible;
        if (visible) visibleCount += 1;
      }

      for (const button of buttons) {
        button.setAttribute("aria-pressed", String(button.dataset.projectFilter === filter));
      }

      if (count) count.innerHTML = `显示 <strong>${visibleCount}</strong> 个项目`;
      if (empty) empty.hidden = visibleCount !== 0;
    };

    buttons.forEach((button, index) => {
      button.addEventListener("click", () => {
        applyFilter((button.dataset.projectFilter ?? "all") as ProjectFilter);
      });

      button.addEventListener("keydown", (event) => {
        const keyDirection = event.key === "ArrowRight" || event.key === "ArrowDown"
          ? 1
          : event.key === "ArrowLeft" || event.key === "ArrowUp"
            ? -1
            : 0;
        const targetIndex = event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : keyDirection === 0
              ? -1
              : (index + keyDirection + buttons.length) % buttons.length;

        if (targetIndex < 0) return;
        event.preventDefault();
        buttons[targetIndex]?.focus();
      });
    });
  });
}

initializeProjectFilters();
document.addEventListener("astro:page-load", initializeProjectFilters);
