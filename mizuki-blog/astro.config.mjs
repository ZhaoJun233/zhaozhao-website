import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";
import { resolveSiteUrl } from "./src/config/build.ts";

export default defineConfig({
  output: "static",
  site: resolveSiteUrl(process.env),
  base: "/",
  trailingSlash: "always",
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
