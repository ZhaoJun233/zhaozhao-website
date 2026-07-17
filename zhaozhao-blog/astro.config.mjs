import cloudflare from "@astrojs/cloudflare";
import { defineConfig } from "astro/config";
import { resolveSiteUrl } from "./src/config/build.ts";

export default defineConfig({
  output: "server",
  adapter: cloudflare({ imageService: "compile", persistState: true }),
  outDir: process.env.BUILD_OUTPUT_DIR ?? "./dist",
  site: resolveSiteUrl(process.env),
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
  }
});
