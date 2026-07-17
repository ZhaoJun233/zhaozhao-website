import { beforeEach } from "vitest";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
