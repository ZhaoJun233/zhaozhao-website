import { env } from "cloudflare:workers";

export function getDatabase(): D1Database {
  return env.DB;
}

export function getMediaStore(): KVNamespace {
  return env.MEDIA;
}
