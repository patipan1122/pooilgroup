// Smoke test — verify protected routes redirect unauthenticated users.
// Without this, a regression to middleware/proxy auth check would silently
// expose admin pages to anonymous visitors.

import { test, expect } from "@playwright/test";

test.describe("Auth guard on protected routes", () => {
  const PROTECTED_ROUTES = [
    "/home",
    "/cashhub/dashboard",
    "/users",
    "/audit",
    "/settings",
  ];

  for (const route of PROTECTED_ROUTES) {
    test(`${route} redirects to /login when not authenticated`, async ({
      page,
    }) => {
      // page.goto follows redirects automatically
      await page.goto(route);
      // After redirect, URL should contain /login
      await expect(page).toHaveURL(/\/login/);
    });
  }
});
