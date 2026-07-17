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
  markdown: {
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark"
      }
    }
  }
});
