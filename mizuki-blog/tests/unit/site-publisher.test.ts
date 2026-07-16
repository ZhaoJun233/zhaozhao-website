import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  activateRelease,
  directoryFingerprint,
  pruneReleases,
  readCurrentRelease,
} from "../../scripts/lib/site-publisher.mjs";

async function stagingRelease(siteRoot: string, name: string, content: string) {
  const staging = join(siteRoot, "releases", `.building-${name}`);
  await mkdir(staging, { recursive: true });
  await writeFile(join(staging, "index.html"), content, "utf8");
  return staging;
}

describe("site publisher", () => {
  it("switches complete releases while preserving the previous version until activation", async () => {
    const siteRoot = await mkdtemp(join(tmpdir(), "mizuki-publisher-"));
    const first = await stagingRelease(siteRoot, "first", "first");
    await activateRelease(siteRoot, first, "first");

    const second = await stagingRelease(siteRoot, "second", "second");
    expect(await readCurrentRelease(siteRoot)).toBe("first");
    expect(await readFile(join(siteRoot, "current", "index.html"), "utf8")).toBe("first");

    await activateRelease(siteRoot, second, "second");
    expect(await readCurrentRelease(siteRoot)).toBe("second");
    expect(await readFile(join(siteRoot, "current", "index.html"), "utf8")).toBe("second");
  });

  it("leaves the active release untouched when activation input is missing", async () => {
    const siteRoot = await mkdtemp(join(tmpdir(), "mizuki-publisher-"));
    const first = await stagingRelease(siteRoot, "first", "first");
    await activateRelease(siteRoot, first, "first");

    await expect(
      activateRelease(siteRoot, join(siteRoot, "releases", "missing"), "missing"),
    ).rejects.toThrow();
    expect(await readCurrentRelease(siteRoot)).toBe("first");
  });

  it("detects nested content changes without watching generated output", async () => {
    const root = await mkdtemp(join(tmpdir(), "mizuki-watch-"));
    await mkdir(join(root, "nested"));
    await writeFile(join(root, "nested", "entry.md"), "one", "utf8");
    const before = await directoryFingerprint([root]);

    await writeFile(join(root, "nested", "entry.md"), "two-two", "utf8");
    expect(await directoryFingerprint([root])).not.toBe(before);

    await symlink(join(root, "nested"), join(root, "linked"), "dir");
    expect(await directoryFingerprint([root])).toBe(await directoryFingerprint([root]));
  });

  it("retains the active release and only the configured number of recent versions", async () => {
    const siteRoot = await mkdtemp(join(tmpdir(), "mizuki-publisher-"));

    for (const release of ["001", "002", "003", "004"]) {
      await activateRelease(
        siteRoot,
        await stagingRelease(siteRoot, release, release),
        release,
      );
    }
    await pruneReleases(siteRoot, 2);

    expect((await readdir(join(siteRoot, "releases"))).sort()).toEqual(["003", "004"]);
    expect(await readCurrentRelease(siteRoot)).toBe("004");
  });
});
