// Regression test — ClawFleet history "แก้ไข (เงิน / มิเตอร์)" admin edit button.
//
// Why this exists: `isHistoryAdmin` is threaded through 6 components
// (StaffAppClient → StaffApp → HomeScreen → PanelScreen → HistoryPanel) as an
// optional prop. On 2026-08-03 one hop silently dropped it and the edit button
// stopped rendering for admins — with no error, no crash, nothing to grep for.
// It took 3 deploys to find because nobody could SEE the button was missing
// without opening the live page. See memory
// clawfleet-edit-round-button-program-admin-gate-2026-08-03.
//
// On 2026-08-09 the prop was made required (not optional) specifically so a
// future dropped hop fails `next build` instead of failing silently in prod.
// This test is the second layer: it proves the button actually renders for a
// real admin account on a real round, not just that the types line up.
//
// Requires CLAUDE_TEST_ADMIN_EMAIL / CLAUDE_TEST_ADMIN_PASSWORD env vars (see
// memory reference-test-admin-account-pooilgroup-2026-08-04) — skips cleanly
// if not set, e.g. in CI environments that haven't been given the test
// credentials yet.

import { test, expect } from "@playwright/test";

const ADMIN_EMAIL = process.env.CLAUDE_TEST_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.CLAUDE_TEST_ADMIN_PASSWORD;

test.describe("ClawFleet — admin edit button on history rounds", () => {
  test.skip(
    !ADMIN_EMAIL || !ADMIN_PASSWORD,
    "CLAUDE_TEST_ADMIN_EMAIL/CLAUDE_TEST_ADMIN_PASSWORD not set — skipping live-account regression test",
  );

  test("admin sees แก้ไข (เงิน / มิเตอร์) on a real collection round", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.locator("#email").fill(ADMIN_EMAIL!);
    await page.locator("#password").fill(ADMIN_PASSWORD!);
    await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });

    await page.goto("/clawfleet/os/app");

    // พิมาย-วังหิน = branch confirmed to have real COLLECTION-type rounds as of
    // 2026-08-09. If this test starts failing purely because that branch has
    // no recent activity, swap the branch name below — that's a fixture problem,
    // not necessarily a code regression. Page renders a duplicate desktop+mobile
    // DOM, so every locator below uses .first().
    await page
      .getByRole("button", { name: "เปลี่ยนสาขาที่กำลังดู" })
      .first()
      .click();
    await page
      .getByRole("dialog", { name: "เลือกสาขาที่จะดู" })
      .getByRole("button", { name: "พิมาย-วังหิน" })
      .first()
      .click();
    await page
      .getByRole("button", { name: "ยืนยันเปลี่ยนสาขา" })
      .first()
      .click();

    await page.getByRole("button", { name: "ประวัติเก็บ" }).first().click();

    const collectionRow = page
      .getByRole("button", { name: /เก็บเงิน/ })
      .first();
    await expect(collectionRow).toBeVisible({ timeout: 10_000 });
    await collectionRow.click();

    await expect(
      page
        .getByRole("button", { name: /แก้ไข \(เงิน \/ มิเตอร์\)/ })
        .first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
