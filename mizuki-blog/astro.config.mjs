import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import { resolveSiteUrl } from "./src/config/build.ts";

export default defineConfig({
  output: "static",
  outDir: process.env.BUILD_OUTPUT_DIR ?? "./dist",
  site: resolveSiteUrl(process.env),
  base: "/",
  trailingSlash: "always",
  devToolbar: { enabled: false },
  integrations: [sitemap()],
  markdown: {
    shikiConfig: {
      themes: {
        light: "github-light",
        dark: "github-dark"
      }
    }
  }
});
