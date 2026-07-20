const revealMotionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const revealSelector = "[data-reveal]";
const staggerSelector = "[data-reveal-stagger]";
const maxStaggerDelay = 560;

let observer: IntersectionObserver | undefined;

function applyStaggerDelays(): void {
  document.querySelectorAll<HTMLElement>(staggerSelector).forEach((group) => {
    const step = Number(group.dataset.revealStagger) || 80;
    group.querySelectorAll<HTMLElement>(revealSelector).forEach((element, index) => {
      element.style.setProperty(
        "--reveal-delay",
        `${Math.min(index * step, maxStaggerDelay)}ms`,
      );
    });
  });
}

function initializeReveals(): void {
  observer?.disconnect();
  observer = undefined;

  if (revealMotionPreference.matches) return;

  const targets = [...document.querySelectorAll<HTMLElement>(revealSelector)].filter(
    (element) => !element.classList.contains("is-revealed"),
  );
  if (targets.length === 0) return;

  applyStaggerDelays();

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-revealed");
        observer?.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0 },
  );

  for (const target of targets) observer.observe(target);
}

initializeReveals();
document.addEventListener("astro:page-load", initializeReveals);
