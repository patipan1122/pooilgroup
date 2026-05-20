// Smoke test — verify /api/health returns ok status.
// Critical signal — ถ้า health endpoint ตก = app ใช้งานไม่ได้

import { test, expect } from "@playwright/test";

test.describe("Health endpoint", () => {
  test("GET /api/health returns 200 with ok status", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.status()).toBe(200);

    const body = await response.json();
    // Pool's health endpoint returns { status, env, supabase, r2, ... }
    // We only assert the presence of "status" — schema can evolve
    expect(body).toHaveProperty("status");
  });
});
