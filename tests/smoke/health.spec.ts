// Smoke test — verify /health returns ok status.
// Critical signal — ถ้า health endpoint ตก = app ใช้งานไม่ได้
//
// Note: route is `/health` (top-level), not `/api/health`.
// `/api/health/deep` ก็มี (deeper check) — ใช้ได้เป็น probe ทุติยภูมิ

import { test, expect } from "@playwright/test";

test.describe("Health endpoint", () => {
  test("GET /health returns 200 with healthy status", async ({ request }) => {
    const response = await request.get("/health");
    expect(response.status()).toBe(200);

    const body = await response.json();
    // Pool's /health returns { status, timestamp, checks: { env, supabase, r2 }, errors }
    expect(body).toHaveProperty("status");
    expect(body.status).toBe("healthy");
    expect(body.checks).toBeDefined();
  });
});
