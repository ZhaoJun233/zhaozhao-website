import { siteConfig } from "../config/site";

type PublishedPost = {
  id: string;
  publishedAt: Date;
};

export type PostMonthGroup<T extends PublishedPost> = {
  key: string;
  year: number;
  month: number;
  label: string;
  posts: T[];
};

const monthFormatter = new Intl.DateTimeFormat(siteConfig.locale, {
  timeZone: siteConfig.timeZone,
  year: "numeric",
  month: "numeric",
});

function compareIdentifiers(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function getDatePart(date: Date, type: "year" | "month"): number {
  const value = monthFormatter.formatToParts(date).find((part) => part.type === type)?.value;

  if (value === undefined) {
    throw new RangeError(`Could not determine ${type} for ${date.toISOString()}.`);
  }

  return Number(value);
}

export function groupPostsByMonth<T extends PublishedPost>(
  posts: readonly T[],
): PostMonthGroup<T>[] {
  const groups = new Map<string, PostMonthGroup<T>>();
  const sortedPosts = [...posts].sort(
    (left, right) =>
      right.publishedAt.getTime() - left.publishedAt.getTime() ||
      compareIdentifiers(left.id, right.id),
  );

  for (const post of sortedPosts) {
    const year = getDatePart(post.publishedAt, "year");
    const month = getDatePart(post.publishedAt, "month");
    const key = `${year}-${String(month).padStart(2, "0")}`;
    const group = groups.get(key);

    if (group) {
      group.posts.push(post);
    } else {
      groups.set(key, {
        key,
        year,
        month,
        label: `${year}年${month}月`,
        posts: [post],
      });
    }
  }

  return [...groups.values()];
}
