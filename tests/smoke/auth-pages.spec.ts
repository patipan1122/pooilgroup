// Smoke test — verify public auth pages render without 500.
// Catches obvious regressions like missing components/imports.

import { test, expect } from "@playwright/test";

test.describe("Public auth pages", () => {
  test("Login page renders", async ({ page }) => {
    const response = await page.goto("/login");
    expect(response?.status()).toBeLessThan(400);
    // Login form should exist (Thai or English label)
    const hasEmailInput = await page.locator('input[type="email"]').count();
    expect(hasEmailInput).toBeGreaterThan(0);
  });

  test("Signup page renders", async ({ page }) => {
    const response = await page.goto("/signup");
    expect(response?.status()).toBeLessThan(400);
  });

  test("Forgot-password page renders", async ({ page }) => {
    const response = await page.goto("/forgot-password");
    expect(response?.status()).toBeLessThan(400);
  });
});
