const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;

export { groupPostsByMonth } from "./date";
export type { PostMonthGroup } from "./date";

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

export type PaginationResult<T> = {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
};

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
