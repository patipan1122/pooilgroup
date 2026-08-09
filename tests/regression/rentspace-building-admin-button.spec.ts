// Regression test — RentSpace "จัดการอาคาร" (Manage Buildings) admin-only button.
//
// Why this exists: same bug class as the ClawFleet history edit button (see
// clawfleet-history-admin-gate.spec.ts) — a button gated by
// `userIsModuleAdmin(rentspace)` that has broken silently before because the
// permission check used the wrong helper (`isCfAdmin(role)` instead of
// `cfHasAdminPower`/`userIsModuleAdmin`). See memory
// rentspace-matrix-manual-reorder-and-building-admin-2026-08-02.
//
// Requires CLAUDE_TEST_ADMIN_EMAIL / CLAUDE_TEST_ADMIN_PASSWORD env vars (see
// memory reference-test-admin-account-pooilgroup-2026-08-04) — skips cleanly
// if not set.

import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.CLAUDE_TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.CLAUDE_TEST_ADMIN_PASSWORD;

test.describe("RentSpace — building-admin button on /rentspace/units", () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD,
    "CLAUDE_TEST_ADMIN_EMAIL/CLAUDE_TEST_ADMIN_PASSWORD not set — skipping live-account regression test",
  );

  test("admin sees and can open จัดการอาคาร", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill(ADMIN_EMAIL!);
    await page.locator("#password").fill(ADMIN_PASSWORD!);
    await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    await page.goto("/rentspace/units");

    const manageBuildingsBtn = page.getByRole("button", {
      name: "จัดการอาคาร",
    });
    await expect(manageBuildingsBtn).toBeVisible({ timeout: 10_000 });
    await manageBuildingsBtn.click();

    // Opens an in-page overlay panel (not a route navigation) — assert on its
    // heading, then close it (read-only — do not create/rename/delete/move).
    await expect(page.getByText("จัดการอาคาร / โซน")).toBeVisible({
      timeout: 5_000,
    });
    await page.getByRole("button", { name: "ปิด" }).click();
  });
});
