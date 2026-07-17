import { describe, expect, it, vi } from "vitest";
import {
  LatestTargetRequest,
  PostUploadCoordinator,
  buildPostMediaPayload,
  nextSlugValue,
  preparePostContextChange,
} from "../../src/lib/admin/post-editor-state";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("article editor client state", () => {
  it("waits for the current upload before allowing immediate save serialization", async () => {
    const uploads = new PostUploadCoordinator();
    const version = uploads.activate("draft:first");
    const upload = deferred<void>();
    let body = "";
    uploads.beginAttempt(version);
    uploads.track(upload.promise.then(() => {
      body = "![ready](/media/ready.webp)";
    }), version);
    const serialize = vi.fn(() => ({ body }));

    const save = uploads.waitForReady(version).then(serialize);
    await Promise.resolve();
    expect(serialize).not.toHaveBeenCalled();

    upload.resolve();
    await expect(save).resolves.toEqual({ body: "![ready](/media/ready.webp)" });
    expect(serialize).toHaveBeenCalledOnce();
  });

  it("unlocks after a failed upload but blocks saving that context", async () => {
    const uploads = new PostUploadCoordinator();
    const version = uploads.activate("draft:failed");
    uploads.beginAttempt(version);
    const tracked = uploads.track(Promise.reject(new Error("upload failed")), version);
    await expect(tracked).rejects.toThrow("upload failed");

    expect(uploads.isPending(version)).toBe(false);
    await expect(uploads.waitForReady(version)).rejects.toThrow("upload failed");
  });

  it("keeps an old upload result from becoming current after a context switch", async () => {
    const uploads = new PostUploadCoordinator();
    const oldVersion = uploads.activate("draft:old");
    const upload = deferred<string>();
    uploads.beginAttempt(oldVersion);
    const tracked = uploads.track(upload.promise, oldVersion);
    const currentVersion = uploads.activate("post:new");
    upload.resolve("old asset");

    await expect(tracked).resolves.toBe("old asset");
    expect(uploads.isCurrent(oldVersion)).toBe(false);
    expect(uploads.isCurrent(currentVersion)).toBe(true);
  });

  it("waits for uploads and cleans an unsaved draft before changing context", async () => {
    const uploads = new PostUploadCoordinator();
    const version = uploads.activate("draft:cleanup");
    const upload = deferred<void>();
    uploads.beginAttempt(version);
    uploads.track(upload.promise, version);
    const cleanup = vi.fn(async () => undefined);

    const changing = preparePostContextChange(
      uploads,
      version,
      { draftToken: "cleanup" },
      cleanup,
    );
    await Promise.resolve();
    expect(cleanup).not.toHaveBeenCalled();
    upload.resolve();
    await changing;
    expect(cleanup).toHaveBeenCalledWith("cleanup");
  });

  it("ignores an older delete preview that resolves after the latest target", async () => {
    const requests = new LatestTargetRequest<string>();
    const first = requests.begin("post-a");
    const second = requests.begin("post-b");
    const firstPreview = deferred<void>();
    const secondPreview = deferred<void>();
    const shown: string[] = [];
    const showWhenCurrent = async (request: typeof first, preview: Promise<void>) => {
      await preview;
      const target = requests.target(request);
      if (target) shown.push(target);
    };

    const firstResult = showWhenCurrent(first, firstPreview.promise);
    const secondResult = showWhenCurrent(second, secondPreview.promise);
    secondPreview.resolve();
    await secondResult;
    firstPreview.resolve();
    await firstResult;

    expect(shown).toEqual(["post-b"]);
    expect(requests.target(first)).toBeUndefined();
    expect(requests.target(second)).toBe("post-b");
    expect(requests.confirm(second)).toBe("post-b");
    expect(requests.confirm(first)).toBeUndefined();
  });

  it("preserves a manually edited slug and serializes retained cover state", () => {
    expect(nextSlugValue("hello-world", "新的标题", true)).toBe("hello-world");
    expect(nextSlugValue("", "Hello World", false)).toBe("hello-world");
    expect(buildPostMediaPayload({
      draftToken: "11111111-1111-4111-8111-111111111111",
      coverAssetId: "22222222-2222-4222-8222-222222222222",
      retainedAssetIds: JSON.stringify([
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      ]),
    })).toEqual({
      draftToken: "11111111-1111-4111-8111-111111111111",
      coverAssetId: "22222222-2222-4222-8222-222222222222",
      retainedAssetIds: [
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
      ],
    });
  });
});
