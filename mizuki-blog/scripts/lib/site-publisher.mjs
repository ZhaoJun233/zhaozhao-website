import { createHash } from "node:crypto";
import {
  access,
  lstat,
  mkdir,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
} from "node:fs/promises";
import { basename, join, relative } from "node:path";

async function addTreeToHash(hash, root, directory, prefix) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const path = join(directory, entry.name);
    const key = `${prefix}/${relative(root, path).replaceAll("\\", "/")}`;

    if (entry.isSymbolicLink()) {
      hash.update(`link:${key}:${await readlink(path)}\n`);
      continue;
    }
    if (entry.isDirectory()) {
      hash.update(`directory:${key}\n`);
      await addTreeToHash(hash, root, path, prefix);
      continue;
    }
    if (entry.isFile()) {
      const metadata = await lstat(path);
      hash.update(`file:${key}:${metadata.size}:${metadata.mtimeMs}\n`);
    }
  }
}

export async function directoryFingerprint(roots) {
  const hash = createHash("sha256");

  for (const [index, root] of roots.entries()) {
    hash.update(`root:${index}\n`);
    await addTreeToHash(hash, root, root, String(index));
  }

  return hash.digest("hex");
}

export async function readCurrentRelease(siteRoot) {
  try {
    return basename(await readlink(join(siteRoot, "current")));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function activateRelease(siteRoot, stagingDirectory, releaseId) {
  await access(join(stagingDirectory, "index.html"));
  const releasesDirectory = join(siteRoot, "releases");
  const releaseDirectory = join(releasesDirectory, releaseId);
  const nextLink = join(siteRoot, `.current-${releaseId}`);

  await mkdir(releasesDirectory, { recursive: true });
  await rename(stagingDirectory, releaseDirectory);
  await rm(nextLink, { force: true });
  await symlink(join("releases", releaseId), nextLink, "dir");
  await rename(nextLink, join(siteRoot, "current"));

  return releaseDirectory;
}

export async function pruneReleases(siteRoot, keep = 3) {
  const releasesDirectory = join(siteRoot, "releases");
  const current = await readCurrentRelease(siteRoot);
  const entries = await readdir(releasesDirectory, { withFileTypes: true });
  const releases = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".building-"))
    .map(({ name }) => name)
    .sort()
    .reverse();
  const retained = new Set(releases.slice(0, Math.max(1, keep)));
  if (current) retained.add(current);

  await Promise.all(
    releases
      .filter((release) => !retained.has(release))
      .map((release) => rm(join(releasesDirectory, release), { recursive: true, force: true })),
  );
}
