import { env } from "cloudflare:workers";

export function getDatabase(): D1Database {
  return env.DB;
}

export function getMediaBucket(): R2Bucket {
  return env.MEDIA;
}
