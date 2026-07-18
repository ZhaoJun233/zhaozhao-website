export interface SearchableMusicTrack {
  title: string;
  artist: string;
  note?: string | null;
}

export function compactWeatherSymbol(code: number): string {
  if ([95, 96, 99].includes(code)) return "ϟ";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "❄";
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "☂";
  if ([1, 2, 3, 45, 48].includes(code)) return "☁";
  return "☼";
}

export function compactWeatherText(area: string, temperature: number): string {
  return `${area} · ${Math.round(temperature)}°`;
}

function searchable(value: string): string {
  return value.toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
}

export function musicTrackMatchesQuery(track: SearchableMusicTrack, query: string): boolean {
  const normalizedQuery = searchable(query);
  if (!normalizedQuery) return true;
  return searchable(`${track.title}${track.artist}${track.note ?? ""}`).includes(normalizedQuery);
}
