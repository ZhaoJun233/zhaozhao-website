CREATE TABLE media_assets (
  id TEXT PRIMARY KEY,
  kv_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER,
  state TEXT NOT NULL DEFAULT 'uploading'
    CHECK (state IN ('uploading', 'ready', 'pending_delete')),
  draft_token TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_media_assets_draft ON media_assets(draft_token, created_at);

CREATE TABLE post_asset_links (
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  usage TEXT NOT NULL CHECK (usage IN ('library', 'cover', 'inline')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, asset_id, usage)
);

CREATE INDEX idx_post_asset_links_asset ON post_asset_links(asset_id);
CREATE UNIQUE INDEX idx_post_asset_one_cover
  ON post_asset_links(post_id) WHERE usage = 'cover';

CREATE TABLE media_cleanup_jobs (
  asset_id TEXT PRIMARY KEY REFERENCES media_assets(id) ON DELETE CASCADE,
  kv_key TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL CHECK (reason IN (
    'article_delete', 'manual_remove', 'draft_cancelled', 'draft_expired',
    'upload_failed', 'backup_restore'
  )),
  queued_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
