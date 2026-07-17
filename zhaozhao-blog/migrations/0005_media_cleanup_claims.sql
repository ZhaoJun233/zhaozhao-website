ALTER TABLE media_cleanup_jobs ADD COLUMN claim_token TEXT;
ALTER TABLE media_cleanup_jobs ADD COLUMN claimed_at TEXT;
ALTER TABLE media_cleanup_jobs ADD COLUMN claim_generation INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_media_cleanup_claimable
  ON media_cleanup_jobs(claim_token, claimed_at, queued_at);

CREATE TABLE post_media_backfill_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cursor_published_at TEXT,
  cursor_post_id TEXT,
  completed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT INTO post_media_backfill_state
  (id, cursor_published_at, cursor_post_id, completed, updated_at)
VALUES (1, NULL, NULL, 0, CURRENT_TIMESTAMP);

CREATE TABLE post_media_backfill_guards (
  run_token TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);

CREATE TABLE media_operation_assertions (
  run_token TEXT PRIMARY KEY,
  value INTEGER NOT NULL CHECK (value = 1)
);
