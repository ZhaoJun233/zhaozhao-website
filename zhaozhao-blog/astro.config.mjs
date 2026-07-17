import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";
import { loadEnv } from "vite";
import { resolveSiteUrl } from "./src/config/build.ts";

const mode = process.env.NODE_ENV ?? "development";
const environment = { ...loadEnv(process.env.NODE_ENV ?? mode, process.cwd(), ""), ...process.env };

export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "compile", persistState: true }),
  outDir: environment.BUILD_OUTPUT_DIR ?? "./dist",
  site: resolveSiteUrl({ ...environment, BUILD_MODE: mode }),
  base: "/",
  trailingSlash: "always",
  devToolbar: { enabled: false },
  vite: {
    build: {
      rollupOptions: {
        output: {
          chunkFileNames: (chunk) => `chunks/${chunk.name.replace(/^\.+/, "_")}-[hash].mjs`,
        },
      },
    },
  },
  markdown: {
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark"
      }
    }
  },
});
