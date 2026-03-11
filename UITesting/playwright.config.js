import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 120_000, // 👈 each test can run up to 2 minutes
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:5173",
    timezoneId: "America/Vancouver",
    trace: "on-first-retry",
    headless: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm --dir ../evote-ui dev --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
  },
});
