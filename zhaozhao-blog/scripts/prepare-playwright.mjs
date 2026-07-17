import { existsSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const statePath = resolve(".wrangler/state/v3");
rmSync(statePath, { recursive: true, force: true });

const variablesPath = resolve(".dev.vars");
if (!existsSync(variablesPath)) {
  writeFileSync(
    variablesPath,
    "ADMIN_PASSWORD=233zhao-local-admin\nADMIN_SESSION_SECRET=playwright-session-secret\n",
    "utf8",
  );
}

const result = spawnSync(
  process.execPath,
  [resolve("node_modules/wrangler/bin/wrangler.js"), "d1", "migrations", "apply", "zhaozhao-blog", "--local"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      XDG_CONFIG_HOME: resolve(".wrangler-config"),
    },
  },
);
if (result.status !== 0) process.exit(result.status ?? 1);
