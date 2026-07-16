export function directoryFingerprint(roots: readonly string[]): Promise<string>;
export function readCurrentRelease(siteRoot: string): Promise<string | undefined>;
export function activateRelease(
  siteRoot: string,
  stagingDirectory: string,
  releaseId: string,
): Promise<string>;
export function pruneReleases(siteRoot: string, keep?: number): Promise<void>;
