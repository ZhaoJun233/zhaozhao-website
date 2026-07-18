import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson } from "../../../../lib/admin/http";
import { getMediaStore } from "../../../../lib/cloudflare/bindings";
import {
  importNeteaseSongMetadata,
  type MetadataCache,
} from "../../../../lib/netease-metadata";
import type { MediaObjectStore } from "../../../../lib/cloudflare/post-media";

interface MusicMetadataRouteDependencies {
  fetcher?: typeof fetch;
  cache?: MetadataCache;
  store?: MediaObjectStore;
}

export function createMusicMetadataRoute({
  fetcher = fetch,
  cache,
  store = getMediaStore(),
}: MusicMetadataRouteDependencies = {}): APIRoute {
  return ({ request }) => handleAdminRequest(
    request,
    async (database) => importNeteaseSongMetadata({
      database,
      store,
      input: await readAdminJson(request),
      fetcher,
      cache,
    }),
  );
}

export const POST = createMusicMetadataRoute();
