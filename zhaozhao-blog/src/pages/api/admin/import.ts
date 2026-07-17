import type { APIRoute } from "astro";
import { handleAdminRequest, readAdminJson } from "../../../lib/admin/http";
import { getMediaStore } from "../../../lib/cloudflare/bindings";
import {
  backfillPostMedia,
  runMediaCleanupBestEffort,
} from "../../../lib/cloudflare/post-media";
import { importBlogData, type BlogBackup } from "../../../lib/database/admin-repository";

export const POST: APIRoute = ({ request }) => handleAdminRequest(request, async (database) => {
  const backup = await readAdminJson(request) as BlogBackup;
  await importBlogData(database, backup);
  const store = getMediaStore();
  if (backup.schemaVersion === 1) {
    await backfillPostMedia(database, store, { batchSize: 3 });
  } else {
    await runMediaCleanupBestEffort(database, store, 5);
  }
  return { imported: true };
});
