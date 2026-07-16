import { taxonomySlug } from "./slug";

export { groupPostsByMonth } from "./date";
export type { PostMonthGroup } from "./date";

const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;

export function estimateReadingMinutes(text: string): number {
  const cjk = text.match(CJK_CHARACTER)?.length ?? 0;
  const latin = text
    .replace(CJK_CHARACTER, " ")
    .match(/[\p{L}\p{N}_'-]+/gu)?.length ?? 0;

  return Math.max(1, Math.ceil(cjk / 400 + latin / 200));
}

export type PublishedPost = {
  id: string;
  publishedAt: Date;
};

export function sortPosts<T extends PublishedPost>(posts: readonly T[]): T[] {
  return [...posts].sort(
    (left, right) =>
      right.publishedAt.getTime() - left.publishedAt.getTime() ||
      compareIdentifiers(left.id, right.id),
  );
}

export type PostEntry = {
  id: string;
  data: {
    publishedAt: Date;
  };
};

export function sortPostEntries<T extends PostEntry>(posts: readonly T[]): T[] {
  return sortPosts(
    posts.map((entry) => ({
      entry,
      id: entry.id,
      publishedAt: entry.data.publishedAt,
    })),
  ).map(({ entry }) => entry);
}

export type PaginationResult<T> = {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
};

export type TaxonomyIndexItem = {
  label: string;
  slug: string;
  count: number;
};

export type CategoryDefinition = {
  name: string;
  description?: string;
};

export type CategoryIndexItem = TaxonomyIndexItem & {
  description?: string;
};

export function buildTaxonomyIndex(values: readonly string[]): TaxonomyIndexItem[] {
  const terms = new Map<string, TaxonomyIndexItem>();

  for (const label of values) {
    const slug = taxonomySlug(label);

    if (slug.length === 0) {
      throw new Error(`Taxonomy value "${label}" produces an empty slug.`);
    }

    const existing = terms.get(slug);

    if (existing === undefined) {
      terms.set(slug, { label, slug, count: 1 });
    } else if (existing.label === label) {
      existing.count += 1;
    } else {
      throw new Error(
        `Taxonomy slug collision: "${existing.label}" and "${label}" both normalize to "${slug}".`,
      );
    }
  }

  return [...terms.values()].sort(
    (left, right) => right.count - left.count || left.label.localeCompare(right.label, "zh-CN"),
  );
}

export function buildCategoryIndex(
  definitions: readonly CategoryDefinition[],
  values: readonly string[],
): CategoryIndexItem[] {
  const usedCategories = buildTaxonomyIndex(values);
  const usedBySlug = new Map(usedCategories.map((category) => [category.slug, category]));
  const managedSlugs = new Set<string>();

  const managedCategories = definitions.map(({ name, description }) => {
    const label = name.trim();
    const slug = taxonomySlug(label);

    if (slug.length === 0) {
      throw new Error(`Category name "${name}" produces an empty slug.`);
    }
    if (managedSlugs.has(slug)) {
      throw new Error(`Managed category slug collision for "${name}".`);
    }

    managedSlugs.add(slug);
    return {
      label,
      slug,
      count: usedBySlug.get(slug)?.count ?? 0,
      ...(description?.trim() ? { description: description.trim() } : {}),
    };
  });

  return [
    ...managedCategories,
    ...usedCategories.filter(({ slug }) => !managedSlugs.has(slug)),
  ];
}

export function paginate<T>(
  items: readonly T[],
  page: number,
  size: number,
): PaginationResult<T> {
  if (page < 1 || size < 1) {
    throw new RangeError("Page and size must be at least 1.");
  }

  const total = items.length;
  const pageCount = Math.ceil(total / size);

  if (total > 0 && page > pageCount) {
    throw new RangeError(`Page ${page} exceeds page count ${pageCount}.`);
  }

  const offset = (page - 1) * size;

  return {
    items: items.slice(offset, offset + size),
    page,
    pageCount,
    total,
  };
}

export type RelatedPost = {
  id: string;
  publishedAt: Date;
  category: string;
  tags: readonly string[];
  series?: string;
};

function compareIdentifiers(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function getRelatedPosts<T extends RelatedPost>(
  current: RelatedPost,
  candidates: readonly T[],
  limit: number,
): T[] {
  const currentTags = new Set(current.tags);

  return candidates
    .filter((candidate) => candidate.id !== current.id)
    .map((candidate) => {
      const sharedTags = new Set(candidate.tags.filter((tag) => currentTags.has(tag)));
      const score =
        (candidate.category === current.category ? 3 : 0) +
        sharedTags.size * 2 +
        (current.series !== undefined && candidate.series === current.series ? 1 : 0);

      return { candidate, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.candidate.publishedAt.getTime() - left.candidate.publishedAt.getTime() ||
        compareIdentifiers(left.candidate.id, right.candidate.id),
    )
    .slice(0, Math.max(0, limit))
    .map(({ candidate }) => candidate);
}
