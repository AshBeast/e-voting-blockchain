import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 120_000, // 👈 each test can run up to 2 minutes
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://localhost:5173",
    timezoneId: "America/Vancouver",
    trace: "on-first-retry",
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: true,
  },
});
