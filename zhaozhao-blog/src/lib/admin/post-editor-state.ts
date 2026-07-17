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

  confirm(request: TargetRequest<T>): T | undefined {
    const target = this.target(request);
    if (target === undefined) return undefined;
    this.invalidate();
    return target;
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
  return manuallyEdited ? currentSlug : taxonomySlug(title);
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
