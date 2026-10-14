import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  use: {
    baseURL: "http://127.0.0.1:4317",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:4317/health",
    reuseExistingServer: true,
    timeout: 30000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
