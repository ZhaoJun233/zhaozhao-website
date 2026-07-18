export type HomePostLayout = "empty" | "single" | "pair" | "grid" | "lead";

export function resolveHomePostLayout(
  postCount: number,
  leadHasCover: boolean,
): HomePostLayout {
  if (postCount <= 0) return "empty";
  if (postCount === 1) return "single";
  if (postCount === 2) return "pair";
  return leadHasCover ? "lead" : "grid";
}
