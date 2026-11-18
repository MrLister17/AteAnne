import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";

const PORT = 3100;
const testDb = process.env.TEST_DATABASE_URL!;

/**
 * E2E runs against a production build on an isolated test database.
 * Mobile-first: the main project emulates an iPhone (Chromium engine with
 * iPhone viewport, touch, DPR and UA); a second checks a 360px Android width.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "off", screenshot: "only-on-failure" },
  projects: [
    { name: "iphone", use: { ...devices["iPhone 15"], browserName: "chromium" } },
    { name: "android-360", use: { browserName: "chromium", viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, testMatch: /(layout|tutorial|scan|install|recovery|equal-receipt|reminders|corrections)\.spec\.ts/ },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { ...process.env, DATABASE_URL: testDb, APP_ORIGIN: `http://localhost:${PORT}`, RATE_LIMIT_DISABLED: "1", STORAGE_DRIVER: "database", RECEIPT_SCAN_FAKE: "1", PRIVATE_UPLOAD_DIR: "./storage/e2e-uploads" } as Record<string, string>,
  },
});
