import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const pidPath = resolve(".wrangler/playwright-server.pid");
const logPath = resolve(".wrangler/playwright-server.log");

function stopRecordedServer() {
  if (!existsSync(pidPath)) return;
  const pid = Number(readFileSync(pidPath, "utf8"));
  if (Number.isInteger(pid) && pid > 0) {
    if (process.platform === "win32") {
      spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try { process.kill(-pid, "SIGKILL"); } catch {}
    }
  }
  unlinkSync(pidPath);
}

export default async function globalSetup() {
  stopRecordedServer();
  const prepare = spawnSync(process.execPath, [resolve("scripts/prepare-playwright.mjs")], {
    stdio: "inherit",
    env: { ...process.env, XDG_CONFIG_HOME: resolve(".wrangler-config") },
  });
  if (prepare.status !== 0) throw new Error("Failed to prepare the Playwright D1 database.");

  const log = openSync(logPath, "w");
  const server = spawn(
    process.execPath,
    [resolve("node_modules/wrangler/bin/wrangler.js"), "dev", "--ip", "127.0.0.1", "--port", "4322"],
    {
      detached: true,
      stdio: ["ignore", log, log],
      env: { ...process.env, XDG_CONFIG_HOME: resolve(".wrangler-config") },
    },
  );
  closeSync(log);
  writeFileSync(pidPath, String(server.pid), "utf8");
  server.unref();

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
    try {
      const response = await fetch("http://127.0.0.1:4322/");
      if (response.ok) return;
    } catch {}
  }
  stopRecordedServer();
  throw new Error(`Playwright Worker preview did not start. See ${logPath}.`);
}
