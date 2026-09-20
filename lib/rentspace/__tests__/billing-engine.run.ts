// RentSpace — regression tests for the billing engine (lib/rentspace/billing.ts):
// buildBill() and its pure helpers (computeMeterUsage, promoDiscountFor,
// effectiveRent). Covers a normal full-month bill AND the mid-month move-out
// proration fix (QA P1 finding — RentalContract.moveOutDate was recorded but
// billing never read it, so tenants who moved out mid-month were billed a
// full month's rent).
//
// WHY THIS EXISTS (2026-09-20 audit): the whole billing engine (buildBill,
// recomputeBillTotals, createBillForContract — computes rent/utility/VAT/
// late-fee amounts) had ZERO test coverage before this file. Only the
// downstream pure computeBillTotals() had a test (bill-math.run.ts).
//
// SCOPE: buildBill() unconditionally calls three Prisma queries (meter
// readings, prior bill for late fee, recurring charges) before it can be
// exercised at all. recomputeBillTotals()/createBillForContract() additionally
// need a live DB (transactions, unique-constraint retry, $transaction) that
// isn't realistically testable from a plain tsx script — per task guidance we
// scope this file to buildBill() (the function that actually contains the
// proration math) called for REAL, with the minimum Prisma surface it touches
// monkey-patched to in-memory fixtures instead of a live DB. This exercises
// the true production code path, not a re-implementation of its formula.
//
// RUNNER (repo has no vitest/jest — plain tsx, same pattern as bill-math.run.ts):
//     npx tsx lib/rentspace/__tests__/billing-engine.run.ts
//   exit code ≠ 0 = มีเคสพัง (CI จะแดง).
//
// NOTE on module-scope prisma import: billing.ts does `import { prisma } from
// "@/lib/prisma"` at module scope, which eagerly constructs a PrismaClient and
// THROWS if DATABASE_URL is unset (see lib/prisma.ts createClient()). We never
// let a real query reach it — every model method buildBill() touches is
// monkey-patched below to read from in-memory fixtures — so a syntactically
// valid placeholder is enough. Only set if the environment doesn't already
// provide a real one (e.g. local .env.local); no query is ever sent through it.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test_placeholder_do_not_connect";

import assert from "node:assert/strict";
// Both dynamic imports (not static) so the DATABASE_URL placeholder above is
// guaranteed to run first — this repo's tsx/esbuild setup transforms plain
// .ts files to CJS, which doesn't support top-level await, so everything that
// needs to await lives inside main() below, invoked at the bottom of the file.

async function main() {
  const { prisma } = await import("@/lib/prisma");

  // ── minimal Prisma mock surface used by buildBill() — no live DB ──────────
  let mockMeterReadings: { kind: string; usage: number; ratePerUnit: number; amountThb: number }[] = [];
  let mockPriorBill: unknown = null; // late-fee lookup; null = no unpaid prior bill (no late-fee cases here)
  let mockRecurringCharges: unknown[] = []; // no recurring charges in these cases (out of scope for this file)

  Object.assign(prisma.rentalMeterReading, { findMany: async () => mockMeterReadings });
  Object.assign(prisma.rentalBill, { findFirst: async () => mockPriorBill });
  Object.assign(prisma.rentalRecurringCharge, { findMany: async () => mockRecurringCharges });

  const { buildBill, computeMeterUsage, promoDiscountFor, effectiveRent, computeBillTotals } = await import(
    "../billing"
  );

  type Contract = Parameters<typeof buildBill>[0];

  /** Minimal fake contract — only the fields buildBill() actually reads (see billing.ts:252-438). */
  function mkContract(overrides: Record<string, unknown> = {}): Contract {
    const base = {
      id: "contract-1",
      orgId: "org-1",
      projectId: "proj-1",
      unitId: "unit-1",
      vatPercent: 7,
      vatOnRent: true,
      vatOnElectric: true,
      vatOnWater: false,
      rentAmountThb: 12000,
      rentSchedule: null,
      startDate: new Date("2020-01-01"), // well before every test period unless overridden
      moveOutDate: null,
      lateFeeType: "none",
      lateFeeValue: 0,
      lateFeeGraceDays: 7,
      rentDueDay: 5,
      billIssueDay: null,
      project: { vatOnRent: true, vatOnElectric: true, vatOnWater: false },
      ...overrides,
    };
    return base as unknown as Contract;
  }

  let failed = 0;
  let total = 0;
  async function runCase(name: string, fn: () => void | Promise<void>): Promise<void> {
    total++;
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ─── buildBill(): rent + metered utilities + VAT ─────────────────────────

  await runCase("normal full-month bill: rent + metered electric/water + VAT computed correctly", async () => {
    // fullRent 12,000 (vatable, vatOnRent=true) + electric 100u×4=400 (vatable, vatOnElectric=true)
    // + water 10u×20=200 (NOT vatable, vatOnWater=false). No proration (contract started 2020,
    // period 2026-03, no moveOutDate).
    mockMeterReadings = [
      { kind: "electric", usage: 100, ratePerUnit: 4, amountThb: 400 },
      { kind: "water", usage: 10, ratePerUnit: 20, amountThb: 200 },
    ];
    mockPriorBill = null;
    const contract = mkContract();
    const built = await buildBill(contract, "2026-03");

    assert.equal(built.rentAmount, 12000);
    assert.equal(built.electricAmount, 400);
    assert.equal(built.waterAmount, 200);
    assert.equal(built.lateFeeAmount, 0);
    assert.deepEqual(
      built.items.map((it) => ({ kind: it.kind, amount: it.amount, vatable: it.vatable })),
      [
        { kind: "rent", amount: 12000, vatable: true },
        { kind: "electric", amount: 400, vatable: true },
        { kind: "water", amount: 200, vatable: false },
      ],
    );
    assert.deepEqual(built.notes, []); // no proration/meter-missing/late-fee notes expected

    // Cross-check the downstream money math by hand:
    //   gross = 12000+400+200 = 12600 · vatableGross = 12000+400 = 12400
    //   no discount → exemptGross doesn't reduce vatableNet → vat = 12400*0.07 = 868.00
    //   subtotal = 12600 · total = 12600+868 = 13468.00
    const totals = computeBillTotals({
      items: built.items.map((it) => ({ amount: it.amount, vatable: it.vatable })),
      approvedDiscount: 0,
      vatPercent: 7,
    });
    assert.deepEqual(totals, { gross: 12600, discountAmount: 0, subtotal: 12600, vatAmount: 868, totalAmount: 13468 });
  });

  await runCase(
    "mid-month move-out proration: rent prorated to days-occupied, electric/water stay usage-based (unprorated)",
    async () => {
      // Contract started long ago (no move-in proration interference). Moves out
      // 2026-06-17 (period is the move-out month, dim(June)=30).
      //   effectiveStartDay = 1 (period !== moveInPeriod) · daysOccupied = min(17-1+1, 30) = 17
      //   rentAmount = round2(10000 * 17/30) = round2(5666.6666...) = 5666.67
      mockMeterReadings = [
        { kind: "electric", usage: 80, ratePerUnit: 5, amountThb: 400 },
        { kind: "water", usage: 8, ratePerUnit: 15, amountThb: 120 },
      ];
      mockPriorBill = null;
      const contract = mkContract({ rentAmountThb: 10000, moveOutDate: new Date("2026-06-17") });
      const built = await buildBill(contract, "2026-06");

      assert.equal(built.rentAmount, 5666.67, "rent must be prorated to 17/30 days occupied");
      assert.equal(built.electricAmount, 400, "electric must stay the full metered amount, NOT prorated");
      assert.equal(built.waterAmount, 120, "water must stay the full metered amount, NOT prorated");
      assert.ok(built.notes.some((n) => n.includes("สัดส่วน")), "should note the mid-month move-out proration");
      const rentItem = built.items.find((it) => it.kind === "rent")!;
      assert.ok(rentItem.label.includes("17/30"), "rent label should show the day-count used");
    },
  );

  await runCase(
    "no move-out THIS period (moveOutDate is set but in a FUTURE period) → full month, unaffected (regression guard)",
    async () => {
      // moveOutPeriod (2026-08) > period (2026-06) — none of the proration branches
      // should fire. This guards against proration accidentally triggering just
      // because moveOutDate is non-null, which is the common "still-active tenant
      // who happens to have a future move-out already scheduled" case.
      mockMeterReadings = [];
      mockPriorBill = null;
      const contract = mkContract({ rentAmountThb: 10000, moveOutDate: new Date("2026-08-05") });
      const built = await buildBill(contract, "2026-06");

      assert.equal(built.rentAmount, 10000, "rent must be the full unprorated amount");
      assert.equal(
        built.items.find((it) => it.kind === "rent")!.label,
        "ค่าเช่า",
        "label must be the plain default, no proration wording",
      );
      assert.ok(
        !built.notes.some((n) => n.includes("ย้ายออก") || n.includes("สัดส่วน")),
        "must not emit any move-out/proration note this period",
      );
    },
  );

  await runCase("boundary: move-out on the VERY FIRST day of the period → only 1 day charged", async () => {
    // period 2026-04 (April, dim=30) · moveOutDay=1 · effectiveStartDay=1
    // daysOccupied = min(1-1+1, 30) = 1 → rentAmount = round2(9000*1/30) = 300.00
    mockMeterReadings = [];
    mockPriorBill = null;
    const contract = mkContract({ rentAmountThb: 9000, moveOutDate: new Date("2026-04-01") });
    const built = await buildBill(contract, "2026-04");
    assert.equal(built.rentAmount, 300, "moving out on day 1 must charge exactly 1/30 of the month");
  });

  await runCase(
    "boundary: move-out on the VERY LAST day of the period → full month charged (no off-by-one)",
    async () => {
      // period 2026-04 (dim=30) · moveOutDay=30 (last day)
      // daysOccupied = min(30-1+1, 30) = 30 → rentAmount = round2(9000*30/30) = 9000 (full)
      mockMeterReadings = [];
      mockPriorBill = null;
      const contract = mkContract({ rentAmountThb: 9000, moveOutDate: new Date("2026-04-30") });
      const built = await buildBill(contract, "2026-04");
      assert.equal(built.rentAmount, 9000, "moving out on the last day must still charge the FULL month, not 29/30");
    },
  );

  await runCase(
    "move-in AND move-out inside the SAME period (short mid-month contract) → prorates from move-in day to move-out day",
    async () => {
      // period 2026-05 (dim=31) · contract starts 2026-05-10 (moveInPeriod===period, startDay=10)
      // · moves out 2026-05-20 (moveOutPeriod===period too)
      // effectiveStartDay = startDay (10, since period===moveInPeriod && startDay>1)
      // daysOccupied = min(20-10+1, 31) = 11 → rentAmount = round2(15500*11/31) = 5500.00 exact
      mockMeterReadings = [];
      mockPriorBill = null;
      const contract = mkContract({
        rentAmountThb: 15500,
        startDate: new Date("2026-05-10"),
        moveOutDate: new Date("2026-05-20"),
      });
      const built = await buildBill(contract, "2026-05");
      assert.equal(built.rentAmount, 5500, "must prorate from move-in day through move-out day, inclusive");
    },
  );

  await runCase("period AFTER the move-out period → rent is 0 (symmetric with pre-contract periods)", async () => {
    // moveOutDate in Jan, billing period is Feb → contract already ended, should
    // never happen in normal operation but the code guards it explicitly (F1 symmetry).
    mockMeterReadings = [];
    mockPriorBill = null;
    const contract = mkContract({ rentAmountThb: 8000, moveOutDate: new Date("2026-01-15") });
    const built = await buildBill(contract, "2026-02");
    assert.equal(built.rentAmount, 0, "no rent should be charged for a period entirely after move-out");
    assert.ok(built.items.find((it) => it.kind === "rent")!.label.includes("งวดหลังย้ายออก"));
  });

  // ─── pure helper functions used by the billing engine (no DB, no mocking needed) ───

  await runCase("computeMeterUsage: normal reading (no reset) → curr - prev", () => {
    assert.equal(computeMeterUsage({ prevReading: 100, currReading: 180, isReset: false }), 80);
  });

  await runCase("computeMeterUsage: meter rollover/replacement (isReset) → (oldFinal - prev) + newCurr", () => {
    // old meter ran 9990 → 9999 (final reading before swap), new meter starts at 0 and now reads 50
    assert.equal(
      computeMeterUsage({ prevReading: 9990, currReading: 50, isReset: true, oldMeterFinal: 9999 }),
      9 + 50,
    );
  });

  await runCase("computeMeterUsage: mis-keyed reading (curr < prev, not a reset) clamps to 0, never negative", () => {
    assert.equal(computeMeterUsage({ prevReading: 200, currReading: 150, isReset: false }), 0);
  });

  await runCase("promoDiscountFor: active promo window returns the per-month discount", () => {
    const contract = mkContract({
      promoDiscountThb: 1000,
      promoMonths: 3,
      promoStartPeriod: "2026-01",
    });
    // period 2026-02 is month index 1 of 0..2 (3 months) → still active
    assert.equal(promoDiscountFor(contract, "2026-02"), 1000);
  });

  await runCase("promoDiscountFor: period past the promo window returns 0", () => {
    const contract = mkContract({
      promoDiscountThb: 1000,
      promoMonths: 3,
      promoStartPeriod: "2026-01",
    });
    // month index for 2026-04 is 3, which is >= promoMonths(3) → expired
    assert.equal(promoDiscountFor(contract, "2026-04"), 0);
  });

  await runCase("effectiveRent: honours rentSchedule escalation for the applicable period", () => {
    const contract = mkContract({
      rentAmountThb: 10000,
      rentSchedule: [
        { fromPeriod: "2026-01", amount: 10000 },
        { fromPeriod: "2026-07", amount: 12000 }, // escalates starting July
      ],
    });
    assert.equal(effectiveRent(contract, "2026-03"), 10000, "before escalation → base rate");
    assert.equal(effectiveRent(contract, "2026-07"), 12000, "at escalation period → new rate");
    assert.equal(effectiveRent(contract, "2026-12"), 12000, "after escalation → still new rate");
  });

  if (failed > 0) {
    console.error(`\nbilling-engine: ${failed}/${total} case(s) FAILED`);
    process.exit(1);
  }
  console.log(`\nbilling-engine: all ${total} cases passed`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
