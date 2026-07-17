export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type ContentStatus = "active" | "completed" | "archived";

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort_order: number;
  enabled: number;
}

export interface FriendRow {
  id: string;
  name: string;
  url: string;
  description: string;
  interests_json: string;
  sort_order: number;
  enabled: number;
  updated_at: string;
}

export interface PostRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  published_at: string;
  updated_at: string | null;
  draft: number;
  category: string;
  tags_json: string;
  cover: string | null;
  cover_alt: string | null;
  featured: number;
  series: string | null;
  canonical_url: string | null;
}

export interface ProjectRow {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  project_date: string;
  status: ContentStatus;
  tags_json: string;
  cover: string | null;
  repository_url: string | null;
  demo_url: string | null;
  featured: number;
  sort_order: number;
}

export type MediaAssetState = "uploading" | "ready" | "pending_delete";
export type PostAssetUsage = "library" | "cover" | "inline";

export interface MediaAssetRow {
  id: string;
  kv_key: string;
  original_name: string;
  content_type: string;
  size_bytes: number | null;
  state: MediaAssetState;
  draft_token: string | null;
  created_at: string;
}

export interface PostAssetLinkRow {
  post_id: string;
  asset_id: string;
  usage: PostAssetUsage;
  sort_order: number;
  created_at: string;
}

export interface MediaCleanupJobRow {
  asset_id: string;
  kv_key: string;
  reason: "article_delete" | "manual_remove" | "draft_cancelled" |
    "draft_expired" | "upload_failed" | "backup_restore";
  queued_at: string;
  attempts: number;
  last_error: string | null;
  claim_token: string | null;
  claimed_at: string | null;
  claim_generation: number;
}
