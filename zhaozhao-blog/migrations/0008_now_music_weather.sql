CREATE TABLE music_tracks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  netease_song_id TEXT NOT NULL UNIQUE
    CHECK (
      netease_song_id <> ''
      AND netease_song_id NOT GLOB '*[^0-9]*'
      AND length(netease_song_id) BETWEEN 1 AND 20
    ),
  cover_asset_id TEXT REFERENCES media_assets(id) ON DELETE RESTRICT,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_music_tracks_enabled_order
  ON music_tracks(enabled, sort_order, title);

INSERT OR IGNORE INTO site_settings (key, value_json, updated_at) VALUES (
  'now_page',
  '{"seoDescription":"访客时间、天气与今日选曲。","hero":{"eyebrow":"A window by the sea","title":"此刻","weatherNotes":{"clear":"天空很轻，适合把喜欢的歌慢慢听完。","cloudy":"云层压低了一点，音乐仍会留住光。","rain":"让雨声和旋律一起落在窗边。","snow":"雪把世界放慢，也把歌声衬得更近。","storm":"雷声经过时，先在这里安静听一首歌。","fallback":"天气暂时藏进云里了。"}},"music":{"eyebrow":"233昭的今日选曲","title":"让海风替我播放","emptyTitle":"唱片架还是空的","emptyDescription":"博主正在挑选第一首歌。","openLabel":"在网易云音乐中打开"}}',
  CURRENT_TIMESTAMP
);

UPDATE site_settings
SET value_json = json_insert(
  value_json,
  '$.items[#]',
  json_object('label', '此刻', 'href', '/now/')
), updated_at = CURRENT_TIMESTAMP
WHERE key = 'navigation'
  AND NOT EXISTS (
    SELECT 1 FROM json_each(value_json, '$.items') item
    WHERE json_extract(item.value, '$.href') = '/now/'
  );
