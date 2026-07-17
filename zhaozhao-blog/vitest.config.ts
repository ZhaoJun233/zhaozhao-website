import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:workers": resolve("tests/unit/cloudflare-workers-stub.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"]
  }
});
