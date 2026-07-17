import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./scripts/playwright-global-setup.mjs",
  globalTeardown: "./scripts/playwright-global-teardown.mjs",
  fullyParallel: true,
  workers: process.env.CI ? 4 : 6,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4322",
    browserName: "chromium",
    trace: "on-first-retry",
  },
  projects: [
    { name: "mobile-320", use: { viewport: { width: 320, height: 568 } } },
    { name: "mobile-390", use: { viewport: { width: 390, height: 844 } } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 } } },
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 900 } } },
    { name: "desktop-1920", use: { viewport: { width: 1920, height: 1080 } } },
  ],
});
