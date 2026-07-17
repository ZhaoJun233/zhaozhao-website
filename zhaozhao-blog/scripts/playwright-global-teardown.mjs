import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

export default function globalTeardown() {
  const pidPath = resolve(".wrangler/playwright-server.pid");
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
