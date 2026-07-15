import { createServer } from "node:http";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";

const siteRoot = resolve("dist");
const outputRoot = resolve("test-results/lighthouse");
const profileRoot = resolve("test-results/lighthouse-chrome");
const runCount = 3;
const pages = [
  ["home", "/"],
  ["posts", "/posts/"],
  ["article", "/posts/astro-content-collections/"],
  ["about", "/about/"],
];
const requiredScores = {
  performance: 0.8,
  accessibility: 0.95,
  "best-practices": 0.9,
  seo: 0.95,
};

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}
const mimeTypes = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
};

async function fileForRequest(requestUrl) {
  const pathname = decodeURIComponent(new URL(requestUrl ?? "/", "http://localhost").pathname);
  const candidate = resolve(siteRoot, pathname.replace(/^\/+/, ""));
  if (relative(siteRoot, candidate).startsWith("..")) return undefined;

  try {
    const details = await stat(candidate);
    return details.isDirectory() ? join(candidate, "index.html") : candidate;
  } catch {
    return undefined;
  }
}

const server = createServer(async (request, response) => {
  try {
    const requestedFile = await fileForRequest(request.url);
    const file = requestedFile ?? join(siteRoot, "404.html");
    const body = await readFile(file);
    response.writeHead(requestedFile ? 200 : 404, {
      "content-type": mimeTypes[extname(file)] ?? "application/octet-stream",
    });
    response.end(body);
  } catch {
    response.writeHead(500);
    response.end("Audit server error");
  }
});

await mkdir(outputRoot, { recursive: true });
await rm(profileRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
await mkdir(profileRoot, { recursive: true });
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));

const address = server.address();
if (!address || typeof address === "string") throw new Error("Audit server did not start.");

const chrome = await launch({
  chromePath: process.env.CHROME_PATH || chromium.executablePath(),
  userDataDir: profileRoot,
  chromeFlags: ["--headless=new", "--disable-gpu", "--no-first-run"],
  logLevel: "silent",
});

const summary = [];
const failures = [];

try {
  for (const [name, pathname] of pages) {
    const url = `http://127.0.0.1:${address.port}${pathname}`;
    const runs = [];

    for (let run = 1; run <= runCount; run += 1) {
      const result = await lighthouse(url, {
        port: chrome.port,
        output: ["html", "json"],
        logLevel: "error",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      });
      if (!result) throw new Error(`Lighthouse returned no result for ${url}`);

      const [htmlReport, jsonReport] = result.report;
      await writeFile(join(outputRoot, `${name}-${run}.html`), htmlReport);
      await writeFile(join(outputRoot, `${name}-${run}.json`), jsonReport);

      runs.push({
        scores: Object.fromEntries(
          Object.entries(result.lhr.categories).map(([category, details]) => [
            category,
            details.score ?? 0,
          ]),
        ),
        lcp: result.lhr.audits["largest-contentful-paint"].numericValue ?? Infinity,
        cls: result.lhr.audits["cumulative-layout-shift"].numericValue ?? Infinity,
      });
    }

    const scores = Object.fromEntries(
      Object.keys(runs[0].scores).map((category) => [
        category,
        median(runs.map(({ scores: runScores }) => runScores[category])),
      ]),
    );
    const metrics = {
      lcp: median(runs.map(({ lcp }) => lcp)),
      cls: median(runs.map(({ cls }) => cls)),
    };
    summary.push({ name, pathname, scores, metrics, runs });

    for (const [category, minimum] of Object.entries(requiredScores)) {
      if ((scores[category] ?? 0) < minimum) {
        failures.push(`${name}: ${category} ${scores[category]} < ${minimum}`);
      }
    }
    if (metrics.lcp >= 2500) failures.push(`${name}: LCP ${metrics.lcp}ms >= 2500ms`);
    if (metrics.cls >= 0.1) failures.push(`${name}: CLS ${metrics.cls} >= 0.1`);

    console.log(
      `${name}: ${Object.entries(scores).map(([key, value]) => `${key}=${value}`).join(" ")} LCP=${Math.round(metrics.lcp)}ms CLS=${metrics.cls.toFixed(3)}`,
    );
  }
} finally {
  chrome.kill();
  await new Promise((resolveClose) => server.close(resolveClose));
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
  await rm(profileRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
    .catch((error) => console.warn(`Chrome profile cleanup deferred: ${error.message}`));
}

await writeFile(join(outputRoot, "summary.json"), JSON.stringify(summary, null, 2));

if (failures.length > 0) {
  throw new Error(`Lighthouse score gates failed:\n${failures.join("\n")}`);
}
