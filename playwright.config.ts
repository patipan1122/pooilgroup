// Playwright smoke test config for Pooilgroup ERP.
// 2026-05-20: ติดตั้งครั้งแรก หลัง Tech Lead audit ระบุ "zero automated tests".
//
// วิธีใช้:
//   # 1. Install browser binaries (one-time · ~200MB download):
//   npm run test:e2e:install
//
//   # 2. Run against deployed Vercel:
//   PLAYWRIGHT_BASE_URL=https://pooilgroup.vercel.app npm run test:e2e
//
//   # 3. Run against local dev (start dev separately first: npm run dev):
//   npm run test:e2e
//
// Smoke tests only — verify app boots + key public routes respond.
// Auth-gated tests (submit report · approve flow) เป็น TODO follow-up
// (ต้องสร้าง test user pool ก่อน).

import { defineConfig, devices } from "@playwright/test";

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
