import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = resolve(import.meta.dirname, "../..");
const generator = resolve(appRoot, "scripts/generate-d1-seed.mjs");
const seedPath = resolve(appRoot, "migrations/0002_seed.sql");

function generateSeed(): string {
  execFileSync(process.execPath, [generator], { cwd: appRoot, stdio: "pipe" });
  return readFileSync(seedPath, "utf8");
}

describe("D1 development seed", () => {
  it("is deterministic and contains every repository fixture", () => {
    const first = generateSeed();
    const second = generateSeed();

    expect(second).toBe(first);
    expect(first.match(/INSERT INTO posts/g)).toHaveLength(6);
    expect(first.match(/INSERT INTO projects/g)).toHaveLength(3);
    expect(first.match(/INSERT INTO categories/g)).toHaveLength(3);
    expect(first.match(/INSERT INTO friends/g)).toHaveLength(4);
    expect(first).toContain("astro-content-collections");
    expect(first).toContain("zhaozhao-blog");
    expect(first).toContain("spring-screen.example");
    expect(first).toContain("seed-setting-profile");
  });
});
