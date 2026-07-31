// RentSpace — regression tests for computeBillTotals (bill money math).
//
// WHY THIS EXISTS (2026-07-31):
//   บิลค่าเช่า A3/14 (INV202607000021) คิด VAT ต่ำกว่าจริง — เดิมส่วนลด (ค่าเช่า)
//   ถูกเฉลี่ยแบบ proportional ไปกินฐานภาษีของค่าไฟ → output VAT ที่ต้องนำส่ง
//   สรรพากรต่ำกว่าความจริง (233.17 แทนที่จะเป็น 375.34). กฎที่ถูก: ส่วนลดหักจาก
//   ยอด "ยกเว้น VAT" ก่อน แล้วจึงล้นลงฐาน VAT เฉพาะส่วนเกิน (exempt-first).
//
// RUNNER (repo ยังไม่มี vitest/jest — ใช้ tsx ตรง ๆ เหมือน lib/ledger/__tests__):
//     npx tsx lib/rentspace/__tests__/bill-math.run.ts
//   exit code ≠ 0 = มีเคสพัง (CI จะแดง).

import assert from "node:assert/strict";
import { computeBillTotals } from "../bill-math";

type Item = { amount: number; vatable: boolean };
type Case = {
  name: string;
  items: Item[];
  approvedDiscount: number;
  vatPercent: number;
  expect: { gross: number; discountAmount: number; subtotal: number; vatAmount: number; totalAmount: number };
};

// ค่าเช่า/อื่น ๆ = ยกเว้น VAT (vatable:false) · ค่าไฟ = เสีย VAT (vatable:true)
const CASES: Case[] = [
  {
    // ── เคสจริงที่พบบั๊ก: A3/14 ก.ค. 2569 ──
    // rent 17,000 (exempt) + electric 5,362 (VAT) + other 78 (exempt), discount 8,500
    // ส่วนลด 8,500 < ยอดยกเว้น 17,078 → ไม่แตะฐาน VAT ค่าไฟเลย → VAT = 5,362 × 7% = 375.34
    name: "A3/14: rent-discount must NOT shrink electricity VAT base",
    items: [
      { amount: 17000, vatable: false },
      { amount: 5362, vatable: true },
      { amount: 78, vatable: false },
    ],
    approvedDiscount: 8500,
    vatPercent: 7,
    expect: { gross: 22440, discountAmount: 8500, subtotal: 13940, vatAmount: 375.34, totalAmount: 14315.34 },
  },
  {
    // ── ส่วนลดล้นยอดยกเว้น → ส่วนเกินลดฐาน VAT (ถูกต้อง) ──
    // rent 1,000 (exempt) + electric 5,000 (VAT), discount 3,000
    // exempt 1,000 → discountOnVatable = 2,000 → vatBase 3,000 → VAT 210
    name: "discount spills past exempt items → excess reduces VAT base",
    items: [
      { amount: 1000, vatable: false },
      { amount: 5000, vatable: true },
    ],
    approvedDiscount: 3000,
    vatPercent: 7,
    expect: { gross: 6000, discountAmount: 3000, subtotal: 3000, vatAmount: 210, totalAmount: 3210 },
  },
  {
    // ── ทุกบรรทัดเสีย VAT (ไม่มีของยกเว้น) → ส่วนลดลดฐาน VAT เต็ม ──
    name: "all items vatable → discount reduces VAT base fully",
    items: [{ amount: 5000, vatable: true }],
    approvedDiscount: 1000,
    vatPercent: 7,
    expect: { gross: 5000, discountAmount: 1000, subtotal: 4000, vatAmount: 280, totalAmount: 4280 },
  },
  {
    // ── ไม่มีของเสีย VAT → VAT = 0 เสมอ ──
    name: "no vatable items → VAT is 0",
    items: [{ amount: 10000, vatable: false }],
    approvedDiscount: 2000,
    vatPercent: 7,
    expect: { gross: 10000, discountAmount: 2000, subtotal: 8000, vatAmount: 0, totalAmount: 8000 },
  },
  {
    // ── ไม่มีส่วนลด (sanity) → VAT เต็มฐานค่าไฟ ──
    name: "no discount → VAT on full electricity base",
    items: [
      { amount: 17000, vatable: false },
      { amount: 5362, vatable: true },
    ],
    approvedDiscount: 0,
    vatPercent: 7,
    expect: { gross: 22362, discountAmount: 0, subtotal: 22362, vatAmount: 375.34, totalAmount: 22737.34 },
  },
  {
    // ── vatPercent = 0 → VAT = 0 ไม่ว่าอะไร ──
    name: "vatPercent 0 → VAT is 0",
    items: [{ amount: 5362, vatable: true }],
    approvedDiscount: 0,
    vatPercent: 0,
    expect: { gross: 5362, discountAmount: 0, subtotal: 5362, vatAmount: 0, totalAmount: 5362 },
  },
  {
    // ── ส่วนลดยักษ์เกิน gross → clamp + ยอดไม่ติดลบ + VAT = 0 ──
    name: "over-large discount clamps to gross, no negative bill",
    items: [
      { amount: 17000, vatable: false },
      { amount: 5362, vatable: true },
    ],
    approvedDiscount: 999999,
    vatPercent: 7,
    expect: { gross: 22362, discountAmount: 22362, subtotal: 0, vatAmount: 0, totalAmount: 0 },
  },
];

let failed = 0;
for (const c of CASES) {
  const got = computeBillTotals({ items: c.items, approvedDiscount: c.approvedDiscount, vatPercent: c.vatPercent });
  try {
    assert.deepEqual(got, c.expect);
    console.log(`  ✓ ${c.name}`);
  } catch {
    failed++;
    console.error(`  ✗ ${c.name}`);
    console.error(`      expected: ${JSON.stringify(c.expect)}`);
    console.error(`      got:      ${JSON.stringify(got)}`);
  }
}

if (failed > 0) {
  console.error(`\nbill-math: ${failed}/${CASES.length} case(s) FAILED`);
  process.exit(1);
}
console.log(`\nbill-math: all ${CASES.length} cases passed`);
