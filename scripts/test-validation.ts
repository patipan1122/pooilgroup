/**
 * ClawFleet — Unit tests for validation.ts (pure functions · no DB needed)
 * Covers: C2 BLOCK, M2-M5, P2-P5, A1, F1
 *
 * Run: npx tsx scripts/test-validation.ts
 */

import { deriveEvent, validatePhotos } from "@/lib/clawfleet/validation";
import { ANOMALY_FLAGS } from "@/lib/clawfleet/types";

type Step = { label: string; pass: boolean; detail?: string };
const results: Step[] = [];
function record(label: string, pass: boolean, detail?: string) {
  results.push({ label, pass, detail });
  console.log(`${pass ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function expect<T>(actual: T, expected: T, name: string): void {
  const pass = actual === expected;
  record(name, pass, pass ? `${actual}` : `got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
}

function expectContains(arr: string[], flag: string, name: string): void {
  const pass = arr.includes(flag);
  record(name, pass, pass ? "" : `flags=${JSON.stringify(arr)}`);
}

function expectNotContains(arr: string[], flag: string, name: string): void {
  const pass = !arr.includes(flag);
  record(name, pass, pass ? "" : `flag ${flag} should NOT be present, got=${JSON.stringify(arr)}`);
}

console.log("=== Validation unit tests ===\n");

// =============================================================
// C2 — meter regress BLOCK (CLAW)
// =============================================================
{
  const r = deriveEvent({
    kind: "CLAW",
    coinMeterBefore: 1000,
    coinMeterAfter: 999, // regress
    cashCountedCents: 0,
    dollMeterBefore: 100,
    dollMeterAfter: 100,
    stockBefore: 30,
    stockAfter: 30,
    refillQty: 0,
    cashPerCoinCents: 1000,
  });
  expect(r.blockReason !== null, true, "C2.CLAW coin regress → blockReason set");
  expectContains(r.flags, ANOMALY_FLAGS.C2_METER_REGRESS, "C2.CLAW flag C2_METER_REGRESS");
}
{
  const r = deriveEvent({
    kind: "CLAW",
    coinMeterBefore: 1000,
    coinMeterAfter: 1010,
    cashCountedCents: 10000,
    dollMeterBefore: 100,
    dollMeterAfter: 99, // doll regress
    stockBefore: 30,
    stockAfter: 30,
    refillQty: 0,
    cashPerCoinCents: 1000,
  });
  expect(r.blockReason !== null, true, "C2.DOLL regress → blockReason set");
}

// =============================================================
// M2 — cash short minor (฿20-100 short AND <5%)
// =============================================================
{
  const r = deriveEvent({
    kind: "CLAW",
    coinMeterBefore: 0,
    coinMeterAfter: 100, // 100 coins × ฿10 = ฿1000 expected
    cashCountedCents: 95000, // ฿950 counted = short ฿50 (5% boundary · M2 if <=)
    dollMeterBefore: 0,
    dollMeterAfter: 5,
    stockBefore: 30,
    stockAfter: 25,
    refillQty: 0,
    cashPerCoinCents: 1000,
  });
  // ฿50 short = 5% exactly · pct (0.05) NOT >0.05 → falls into M2 range (20-100 absolute)
  expectContains(r.flags, ANOMALY_FLAGS.M2_CASH_SHORT_MINOR, "M2 cash short ฿50/5% → M2_CASH_SHORT_MINOR");
  expectNotContains(r.flags, ANOMALY_FLAGS.M3_CASH_SHORT_MAJOR, "M2 not also M3");
}

// =============================================================
// M3 — cash short major (>฿100 or >5%)
// =============================================================
{
  const r = deriveEvent({
    kind: "CLAW",
    coinMeterBefore: 0,
    coinMeterAfter: 100, // 100 coins × ฿10 = ฿1,000 expected
    cashCountedCents: 80000, // ฿800 counted, short ฿200 (20%)
    dollMeterBefore: 0,
    dollMeterAfter: 5,
    stockBefore: 30,
    stockAfter: 25,
    refillQty: 0,
    cashPerCoinCents: 1000,
  });
  expectContains(r.flags, ANOMALY_FLAGS.M3_CASH_SHORT_MAJOR, "M3 short ฿200 (20%) → M3_CASH_SHORT_MAJOR");
}

// =============================================================
// M4 — cash over (>฿50)
// =============================================================
{
  const r = deriveEvent({
    kind: "CLAW",
    coinMeterBefore: 0,
    coinMeterAfter: 10, // expected ฿100
    cashCountedCents: 20000, // ฿200 counted = +฿100 over
    dollMeterBefore: 0,
    dollMeterAfter: 1,
    stockBefore: 30,
    stockAfter: 29,
    refillQty: 0,
    cashPerCoinCents: 1000,
  });
  expectContains(r.flags, ANOMALY_FLAGS.M4_CASH_OVER, "M4 over ฿100 → M4_CASH_OVER");
}

// =============================================================
// M5 — meter not move but cash exists → BLOCK
// =============================================================
{
  const r = deriveEvent({
    kind: "CLAW",
    coinMeterBefore: 1000,
    coinMeterAfter: 1000, // no change
    cashCountedCents: 5000, // but has cash
    dollMeterBefore: 100,
    dollMeterAfter: 100,
    stockBefore: 30,
    stockAfter: 30,
    refillQty: 0,
    cashPerCoinCents: 1000,
  });
  expect(r.blockReason !== null, true, "M5 meter still + cash > 0 → blockReason");
  expectContains(r.flags, ANOMALY_FLAGS.M5_METER_NO_MOVE_BUT_CASH, "M5 flag set");
}

// =============================================================
// P2 — doll variance minor (1-2 ตัว AND <10%)
// =============================================================
{
  const r = deriveEvent({
    kind: "CLAW",
    coinMeterBefore: 0,
    coinMeterAfter: 50,
    cashCountedCents: 50000,
    dollMeterBefore: 100,
    dollMeterAfter: 120, // 20 dolls per meter
    stockBefore: 30,
    stockAfter: 9, // 21 stock moved (1 variance) · 1/20 = 5% < 10% threshold
    refillQty: 0,
    cashPerCoinCents: 1000,
  });
  expectContains(r.flags, ANOMALY_FLAGS.P2_DOLL_VARIANCE_MINOR, "P2 variance 1/20=5% → P2_DOLL_VARIANCE_MINOR");
}

// =============================================================
// P3 — doll variance major (>2 or >10%)
// =============================================================
{
  const r = deriveEvent({
    kind: "CLAW",
    coinMeterBefore: 0,
    coinMeterAfter: 10,
    cashCountedCents: 10000,
    dollMeterBefore: 100,
    dollMeterAfter: 105, // 5 per meter
    stockBefore: 30,
    stockAfter: 20, // 10 stock moved (5 variance — 100%)
    refillQty: 0,
    cashPerCoinCents: 1000,
  });
  expectContains(r.flags, ANOMALY_FLAGS.P3_DOLL_VARIANCE_MAJOR, "P3 variance 5 → P3");
}

// =============================================================
// P4 — doll moves but coin doesn't → BLOCK
// =============================================================
{
  const r = deriveEvent({
    kind: "CLAW",
    coinMeterBefore: 1000,
    coinMeterAfter: 1000, // no coins
    cashCountedCents: 0,
    dollMeterBefore: 100,
    dollMeterAfter: 105, // but dolls dispensed
    stockBefore: 30,
    stockAfter: 25,
    refillQty: 0,
    cashPerCoinCents: 1000,
  });
  // Note: M5 fires first because coin=0 + cash=0 doesn't trigger M5 (need cash > 0).
  // Here cash=0 so M5 not fire. P4 should fire.
  expect(r.blockReason !== null, true, "P4 doll+ coin=0 → blockReason");
  expectContains(r.flags, ANOMALY_FLAGS.P4_DOLL_NO_COIN, "P4 flag set");
}

// =============================================================
// P5 — coin moves but doll doesn't (ตู้คีบยาก)
// =============================================================
{
  const r = deriveEvent({
    kind: "CLAW",
    coinMeterBefore: 0,
    coinMeterAfter: 50, // 50 attempts
    cashCountedCents: 50000, // ฿500
    dollMeterBefore: 100,
    dollMeterAfter: 100, // 0 dispensed
    stockBefore: 30,
    stockAfter: 30,
    refillQty: 0,
    cashPerCoinCents: 1000,
  });
  expectContains(r.flags, ANOMALY_FLAGS.P5_COIN_NO_DOLL, "P5 50 coins, 0 doll → P5_COIN_NO_DOLL");
}

// =============================================================
// A1 — Anomaly baseline (low extreme)
// =============================================================
{
  const r = deriveEvent({
    kind: "CLAW",
    coinMeterBefore: 0,
    coinMeterAfter: 10,
    cashCountedCents: 10000, // ฿100 (median is ฿100,000 - way below)
    dollMeterBefore: 0,
    dollMeterAfter: 1,
    stockBefore: 30,
    stockAfter: 29,
    refillQty: 0,
    cashPerCoinCents: 1000,
    medianRevenueCents: 100000, // ฿1,000 median; 10% of median
  });
  expectContains(r.flags, ANOMALY_FLAGS.A1_REVENUE_OUTLIER, "A1 revenue 10% of median → A1");
}

// =============================================================
// A1 — Anomaly baseline (high extreme)
// =============================================================
{
  const r = deriveEvent({
    kind: "CLAW",
    coinMeterBefore: 0,
    coinMeterAfter: 1000,
    cashCountedCents: 1000000, // ฿10,000
    dollMeterBefore: 0,
    dollMeterAfter: 50,
    stockBefore: 60,
    stockAfter: 10,
    refillQty: 0,
    cashPerCoinCents: 1000,
    medianRevenueCents: 100000, // ฿1,000 median; revenue 1000% of median
  });
  expectContains(r.flags, ANOMALY_FLAGS.A1_REVENUE_OUTLIER, "A1 revenue 1000% of median → A1");
}

// =============================================================
// G6 — Promo discount > 30% (EXCHANGER)
// =============================================================
{
  const r = deriveEvent({
    kind: "EXCHANGER",
    coinMeterBefore: 0,
    coinMeterAfter: 100, // 100 coins dispensed
    cashCountedCents: 100000, // ฿1,000
    promoCoinsDispensed: 40, // 40 coins of promo (40% > 30%)
    cashPerCoinCents: 1000,
  });
  expectContains(r.flags, ANOMALY_FLAGS.G6_PROMO_HIGH, "G6 promo 40% > 30% → G6_PROMO_HIGH");
}

// =============================================================
// Happy path — no flags
// =============================================================
{
  const r = deriveEvent({
    kind: "CLAW",
    coinMeterBefore: 0,
    coinMeterAfter: 10,
    cashCountedCents: 10000, // exactly expected
    dollMeterBefore: 0,
    dollMeterAfter: 1,
    stockBefore: 30,
    stockAfter: 29,
    refillQty: 0,
    cashPerCoinCents: 1000,
  });
  expect(r.blockReason, null, "Happy path no blockReason");
  expect(r.flags.length, 0, "Happy path no flags");
}

// =============================================================
// F1 — photos missing (CLAW)
// =============================================================
{
  const r = validatePhotos("CLAW", {
    photoMeterBeforeUrl: "url",
    photoCashUrl: "url",
    photoMeterAfterUrl: "url",
    photoStockUrl: null,
  });
  expect(r.ok, false, "F1.CLAW missing photoStockUrl → blocked");
}
{
  const r = validatePhotos("CLAW", {
    photoMeterBeforeUrl: "url",
    photoCashUrl: "url",
    photoMeterAfterUrl: "url",
    photoStockUrl: "url",
  });
  expect(r.ok, true, "F1.CLAW all 4 photos → ok");
}
{
  const r = validatePhotos("EXCHANGER", {
    photoMeterBeforeUrl: "url",
    photoCashUrl: "url",
    photoMeterAfterUrl: "url",
    photoStockUrl: null, // not required for EX
  });
  expect(r.ok, true, "F1.EX 3 photos (no stock) → ok");
}
{
  const r = validatePhotos("EXCHANGER", {
    photoMeterBeforeUrl: null,
    photoCashUrl: "url",
    photoMeterAfterUrl: "url",
    photoStockUrl: null,
  });
  expect(r.ok, false, "F1.EX missing meter_before → blocked");
}

console.log("\n=== Summary ===");
const pass = results.filter((r) => r.pass).length;
const fail = results.filter((r) => !r.pass).length;
console.log(`PASS: ${pass} · FAIL: ${fail} · TOTAL: ${results.length}`);
if (fail > 0) {
  console.log("\nFailures:");
  results.filter((r) => !r.pass).forEach((r) => console.log(`  ❌ ${r.label} — ${r.detail ?? ""}`));
  process.exit(1);
}
process.exit(0);
