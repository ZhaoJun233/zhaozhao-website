import { spawn } from "node:child_process";
import { cp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  activateRelease,
  directoryFingerprint,
  pruneReleases,
} from "./lib/site-publisher.mjs";

const require = createRequire(import.meta.url);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = resolve(process.env.SITE_ROOT ?? "/site");
const pollInterval = Number.parseInt(process.env.POLL_INTERVAL_MS ?? "1000", 10);
const watchRoots = [resolve(appRoot, "src"), resolve(appRoot, "public")];
const astroBin = resolve(dirname(require.resolve("astro/package.json")), "bin/astro.mjs");
const pagefindBin = resolve(
  dirname(fileURLToPath(import.meta.resolve("pagefind"))),
  "runner/bin.cjs",
);
const once = process.argv.includes("--once");
let activeChild;
let stopping = false;

if (!Number.isFinite(pollInterval) || pollInterval < 250) {
  throw new Error("POLL_INTERVAL_MS must be at least 250 milliseconds.");
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function run(command, args, environment) {
  return new Promise((resolvePromise, reject) => {
    activeChild = spawn(command, args, {
      cwd: appRoot,
      env: environment,
      stdio: "inherit",
    });
    activeChild.once("error", reject);
    activeChild.once("exit", (code, signal) => {
      activeChild = undefined;
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

async function writeStatus(status) {
  const temporary = resolve(siteRoot, ".build-status.next.json");
  const destination = resolve(siteRoot, "build-status.json");
  await writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, "utf8");
  await rename(temporary, destination);
}

async function buildRelease() {
  const releaseId = `${Date.now()}-${process.pid}`;
  const localStaging = resolve(appRoot, ".publisher-build", releaseId);
  const publishedStaging = resolve(siteRoot, "releases", `.building-${releaseId}`);
  const startedAt = new Date().toISOString();
  const environment = {
    ...process.env,
    BUILD_MODE: "production",
    BUILD_OUTPUT_DIR: localStaging,
  };

  await mkdir(resolve(siteRoot, "releases"), { recursive: true });
  await rm(localStaging, { recursive: true, force: true });
  await rm(publishedStaging, { recursive: true, force: true });
  await writeStatus({ status: "building", releaseId, startedAt });

  try {
    await run(process.execPath, [astroBin, "build"], environment);
    await run(process.execPath, [pagefindBin, "--site", localStaging], environment);
    await cp(localStaging, publishedStaging, { recursive: true, errorOnExist: true });
    await activateRelease(siteRoot, publishedStaging, releaseId);
  } catch (error) {
    await rm(localStaging, { recursive: true, force: true });
    await rm(publishedStaging, { recursive: true, force: true });
    await writeStatus({
      status: "failed",
      releaseId,
      startedAt,
      failedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }).catch((statusError) => console.error("[publisher] Could not write failure status.", statusError));
    console.error("[publisher] Build failed; keeping the current release.", error);
    return false;
  }

  await rm(localStaging, { recursive: true, force: true });
  await pruneReleases(siteRoot).catch((error) =>
    console.error("[publisher] Could not prune old releases.", error),
  );
  await writeStatus({
    status: "ready",
    releaseId,
    startedAt,
    completedAt: new Date().toISOString(),
  }).catch((error) => console.error("[publisher] Could not write ready status.", error));
  console.log(`[publisher] Activated release ${releaseId}`);
  return true;
}

async function main() {
  await mkdir(siteRoot, { recursive: true });
  const initialFingerprint = await directoryFingerprint(watchRoots);
  const initialBuildSucceeded = await buildRelease();

  if (once) {
    if (!initialBuildSucceeded) process.exitCode = 1;
    return;
  }

  let publishedFingerprint = initialBuildSucceeded ? initialFingerprint : undefined;

  while (!stopping) {
    await sleep(pollInterval);
    const nextFingerprint = await directoryFingerprint(watchRoots);
    if (nextFingerprint === publishedFingerprint) continue;

    if (await buildRelease()) publishedFingerprint = nextFingerprint;
  }
}

function shutdown() {
  stopping = true;
  activeChild?.kill("SIGTERM");
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await main();
