import { defineConfig, devices } from "@playwright/test";
import path from "path";
import { BASE_URL } from "./helpers/env";

const outputDir = path.join(__dirname, "test-results");
const reportDir = path.join(__dirname, "playwright-report");

export default defineConfig({
  testDir: path.join(__dirname, "tests"),
  timeout: 60000,
  expect: {
    timeout: 10000,
  },
  retries: process.env.CI ? 2 : 0,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: reportDir, open: "never" }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
  outputDir,
  globalSetup: path.join(__dirname, "global-setup.ts"),
});
