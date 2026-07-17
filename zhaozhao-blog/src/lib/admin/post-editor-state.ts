import { taxonomySlug } from "../slug";

export type ClientPostContext = { postId?: string; draftToken: string };

type UploadBucket = {
  pending: Set<Promise<unknown>>;
  failure?: Error;
};

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error("图片上传失败。");
}

export class PostUploadCoordinator {
  private version = 0;
  private readonly buckets = new Map<number, UploadBucket>();
  private readonly listeners = new Set<() => void>();

  activate(_key: string): number {
    this.version += 1;
    this.buckets.set(this.version, { pending: new Set() });
    this.notify();
    return this.version;
  }

  currentVersion(): number {
    return this.version;
  }

  isCurrent(version: number): boolean {
    return version === this.version;
  }

  isPending(version = this.version): boolean {
    return (this.buckets.get(version)?.pending.size ?? 0) > 0;
  }

  beginAttempt(version = this.version): void {
    const bucket = this.bucket(version);
    if (bucket.pending.size === 0) bucket.failure = undefined;
    this.notify();
  }

  track<T>(task: Promise<T>, version = this.version): Promise<T> {
    const bucket = this.bucket(version);
    const tracked = task
      .catch((error: unknown) => {
        bucket.failure = asError(error);
        throw error;
      })
      .finally(() => {
        bucket.pending.delete(tracked);
        if (!this.isCurrent(version) && bucket.pending.size === 0) this.buckets.delete(version);
        this.notify();
      });
    bucket.pending.add(tracked);
    this.notify();
    return tracked;
  }

  async waitForSettled(version = this.version): Promise<Error | undefined> {
    const bucket = this.bucket(version);
    while (bucket.pending.size > 0) {
      await Promise.allSettled([...bucket.pending]);
    }
    return bucket.failure;
  }

  async waitForReady(version = this.version): Promise<void> {
    const failure = await this.waitForSettled(version);
    if (!this.isCurrent(version)) throw new Error("文章编辑上下文已经切换。");
    if (failure) throw failure;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private bucket(version: number): UploadBucket {
    const current = this.buckets.get(version);
    if (current) return current;
    const created = { pending: new Set<Promise<unknown>>() };
    this.buckets.set(version, created);
    return created;
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export class ContextActionQueue {
  private externalLocks = 0;
  private queuedActions = 0;
  private running = false;
  private tail: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<() => void>();

  isLocked(): boolean {
    return this.externalLocks > 0 || this.queuedActions > 0 || this.running;
  }

  acquire(): () => void {
    this.externalLocks += 1;
    this.notify();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.externalLocks = Math.max(0, this.externalLocks - 1);
      this.notify();
    };
  }

  enqueue<T>(action: () => T | Promise<T>): Promise<T> {
    this.queuedActions += 1;
    this.notify();
    const run = async () => {
      this.queuedActions -= 1;
      this.running = true;
      this.notify();
      try {
        return await action();
      } finally {
        this.running = false;
        this.notify();
      }
    };
    const result = this.tail.then(run, run);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  enqueueIfUnlocked<T>(action: () => T | Promise<T>): Promise<T> | undefined {
    return this.isLocked() ? undefined : this.enqueue(action);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export type TargetRequest<T> = Readonly<{ version: number; target: T }>;

export class LatestTargetRequest<T> {
  private version = 0;
  private current?: TargetRequest<T>;

  begin(target: T): TargetRequest<T> {
    this.current = { version: ++this.version, target };
    return this.current;
  }

  target(request: TargetRequest<T>): T | undefined {
    return this.current?.version === request.version ? this.current.target : undefined;
  }

  complete(request: TargetRequest<T>): void {
    if (this.target(request) !== undefined) this.invalidate();
  }

  invalidate(): void {
    this.version += 1;
    this.current = undefined;
  }
}

export async function preparePostContextChange(
  uploads: PostUploadCoordinator,
  version: number,
  context: ClientPostContext,
  cleanupDraft: (draftToken: string) => Promise<unknown>,
): Promise<void> {
  await uploads.waitForSettled(version);
  if (!context.postId && context.draftToken) await cleanupDraft(context.draftToken);
}

export function nextSlugValue(currentSlug: string, title: string, manuallyEdited: boolean): string {
  if (manuallyEdited) return currentSlug;
  const generated = taxonomySlug(title)
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return generated || currentSlug;
}

export function buildPostMediaPayload(input: {
  draftToken: string;
  coverAssetId: string;
  retainedAssetIds: string;
}): { draftToken: string; coverAssetId?: string; retainedAssetIds: string[] } {
  let retainedAssetIds: string[] = [];
  try {
    const parsed = JSON.parse(input.retainedAssetIds || "[]") as unknown;
    if (Array.isArray(parsed)) {
      retainedAssetIds = [...new Set(parsed.filter((id): id is string => typeof id === "string"))];
    }
  } catch {
    retainedAssetIds = [];
  }
  return {
    draftToken: input.draftToken,
    ...(input.coverAssetId ? { coverAssetId: input.coverAssetId } : {}),
    retainedAssetIds,
  };
}

export function postContextKey(context: ClientPostContext): string {
  return context.postId ? `post:${context.postId}` : `draft:${context.draftToken}`;
}

export const postUploadCoordinator = new PostUploadCoordinator();
