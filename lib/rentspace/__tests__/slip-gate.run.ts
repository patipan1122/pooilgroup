// RentSpace — regression tests for evaluateBillSlipGate() (lib/rentspace/ledger-push.ts).
//
// WHY THIS EXISTS (2026-09-20 audit):
//   evaluateBillSlipGate() is the LAST gate before a bill's payments get pushed
//   into ledger_revenue_entry (RentSpace → LedgerLine bridge). If it wrongly lets
//   a mismatched-slip bill through, a payment could get recorded/reconciled in
//   the accounting system as "verified" when the AI-read slip amount doesn't
//   actually match what was recorded — real money risk. It had ZERO test
//   coverage before this file.
//
// RUNNER (repo has no vitest/jest — plain tsx, same pattern as bill-math.run.ts):
//     npx tsx lib/rentspace/__tests__/slip-gate.run.ts
//   exit code ≠ 0 = มีเคสพัง (CI จะแดง).
//
// NOTE on module-scope prisma import: ledger-push.ts does `import { prisma }
// from "@/lib/prisma"` at module scope, which eagerly constructs a PrismaClient
// and THROWS if DATABASE_URL is unset (see lib/prisma.ts createClient()).
// evaluateBillSlipGate() itself is documented as pure ("แยกออกมาเป็นฟังก์ชัน
// pure ต่างหาก (ไม่พึ่ง DB/AI ตรงนี้)") — this test never issues a real query,
// so a syntactically-valid placeholder connection string is enough. We only
// set it if the environment doesn't already provide a real one (e.g. local
// .env.local), and no query is ever sent through it.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test_placeholder_do_not_connect";

import assert from "node:assert/strict";
// dynamic import (not a static one) so the DATABASE_URL placeholder above is
// guaranteed to run first — this repo's tsx/esbuild setup transforms plain
// .ts files to CJS, which doesn't support top-level await, so the import +
// the CASES loop below both live inside main() and are invoked at the bottom.

type Payment = {
  id: string;
  paidOn: Date;
  slipUrl: string | null;
  amountThb: unknown;
};
type Bill = { id: string; payments: Payment[] };

function payment(id: string, amountThb: number, opts: { slipUrl?: string | null; paidOn?: Date } = {}): Payment {
  return {
    id,
    paidOn: opts.paidOn ?? new Date("2026-09-10"),
    // NOTE: "slipUrl" in opts (not `??`) — a case explicitly passing slipUrl:
    // null must keep null, not fall back to the default URL (`??` would treat
    // an explicit null as "not provided" and silently defeat the no-slip case).
    slipUrl: "slipUrl" in opts ? (opts.slipUrl ?? null) : `https://slips.example/${id}.jpg`,
    amountThb,
  };
}

type Case = {
  name: string;
  bill: Bill;
  ocrMap: Map<string, number | null>;
  /** throws (via node:assert) on failure — checked against the real reasons[] returned */
  check: (reasons: string[]) => void;
};

const CASES: Case[] = [
  {
    // ── ยอดสลิปตรงกับที่บันทึกไว้เป๊ะ → ผ่าน ไม่มีเหตุผลกัน ──
    name: "exact match → gate passes (empty reasons)",
    bill: { id: "b1", payments: [payment("p1", 1500)] },
    ocrMap: new Map([["p1", 1500]]),
    check: (reasons) => assert.deepEqual(reasons, []),
  },
  {
    // ── ยอดสลิปไม่ตรง → ต้องมีเหตุผล 1 ข้อ อ้างอิงทั้งยอดที่บันทึกและยอดที่ AI อ่านได้ ──
    name: "slip amount differs from recorded → one mismatch reason, mentions both amounts",
    bill: { id: "b2", payments: [payment("p2", 1500)] },
    ocrMap: new Map([["p2", 1650]]),
    check: (reasons) => {
      assert.equal(reasons.length, 1);
      assert.ok(reasons[0].includes((1500).toLocaleString("th-TH")), "should mention recorded amount");
      assert.ok(reasons[0].includes((1650).toLocaleString("th-TH")), "should mention OCR-read amount");
    },
  },
  {
    // ── บิลมี 2 payment: อันหนึ่งตรง อันหนึ่งไม่ตรง → ต้องแฟล็กเฉพาะอันที่ไม่ตรง ──
    name: "two payments, one matches one doesn't → flags only the mismatched one",
    bill: {
      id: "b3",
      payments: [payment("p3a", 1000), payment("p3b", 2000)],
    },
    ocrMap: new Map([
      ["p3a", 1000], // ตรง
      ["p3b", 2500], // ไม่ตรง
    ]),
    check: (reasons) => {
      assert.equal(reasons.length, 1);
      assert.ok(reasons[0].includes((2000).toLocaleString("th-TH")));
      assert.ok(reasons[0].includes((2500).toLocaleString("th-TH")));
    },
  },
  {
    // ── payment ที่ "พยายามอ่านแล้วแต่อ่านไม่ออก" (ไม่มีใน map เลย) → fail-closed
    //    ต้องถูกแฟล็ก (ประเมินไม่ได้ ≠ ผ่านเงียบๆ) — นี่คือพฤติกรรมของ evaluateBillSlipGate
    //    เอง ตามคอมเมนต์ในซอร์ส "อ่านไม่ออก = ประเมินไม่ได้ → fail-closed" ──
    name: "payment missing from ocrMap entirely (read attempted, unresolved) → fail-closed, flagged",
    bill: { id: "b4", payments: [payment("p4", 1200)] },
    ocrMap: new Map(), // ไม่มี p4 เลย → .get() คืน undefined → ??null → ประเมินไม่ได้
    check: (reasons) => {
      assert.equal(reasons.length, 1);
      assert.ok(reasons[0].includes("อ่านยอดในสลิปไม่ออก"));
    },
  },
  {
    // ── เหมือนเคสบน แต่ explicit null (AI อ่านแล้วได้ null) → ผลเหมือนกันทุกประการ
    //    (พิสูจน์ว่า "ไม่มีใน map" กับ "null ชัดเจน" เทียบเท่ากันจากมุม evaluateBillSlipGate) ──
    name: "payment explicitly mapped to null (AI read failed) → same fail-closed result",
    bill: { id: "b5", payments: [payment("p5", 1200)] },
    ocrMap: new Map([["p5", null]]),
    check: (reasons) => {
      assert.equal(reasons.length, 1);
      assert.ok(reasons[0].includes("อ่านยอดในสลิปไม่ออก"));
    },
  },
  {
    // ── "unread ≠ wrong" (per getSlipMismatchBillIds' comment: "payment ที่ยังไม่เคย
    //    อ่านสลิปเลย ไม่ถูกนับเป็นเหตุผลเลย") — สำคัญ: distinction นี้ไม่ได้อยู่ใน
    //    evaluateBillSlipGate เอง (เคสข้างบนพิสูจน์แล้วว่ามันเป็น fail-closed เสมอถ้าไม่มี
    //    ค่า OCR) แต่อยู่ที่ "ผู้เรียก" — getSlipMismatchBillIds กรอง payment ที่ยังไม่เคย
    //    อ่าน (ocrReadAt null) ออกจาก bill.payments *ก่อน* ส่งเข้าฟังก์ชันนี้เลย (ดู query
    //    `ocrReadAt: { not: null }` ใน ledger-push.ts). จำลองพฤติกรรมนั้นตรงนี้: payment
    //    ที่ยังไม่เคยอ่าน (p6b) ไม่ถูกใส่เข้า bill.payments ตั้งแต่แรก → ไม่มีทางถูกแฟล็ก
    //    เพราะฟังก์ชันไม่เคยเห็นมันเลย (ต่างจากเคสบนที่ "เห็น" payment แต่ประเมินไม่ได้) ──
    name: "unread payment excluded from bill.payments upstream (mirrors getSlipMismatchBillIds filter) → not flagged",
    bill: {
      id: "b6",
      payments: [
        payment("p6a", 800), // เคยอ่านแล้ว ตรงยอด
        // p6b (ยังไม่เคยอ่านสลิป) ถูกกรองออกไปแล้วโดยผู้เรียก — ไม่ปรากฏใน array นี้เลย
      ],
    },
    ocrMap: new Map([["p6a", 800]]),
    check: (reasons) => assert.deepEqual(reasons, []),
  },
  {
    // ── tolerance: diff เท่ากับ 1 บาทพอดี (`Math.abs(...) > 1` เป็น strictly-greater-than)
    //    → ยังไม่ถูกแฟล็ก (ขอบเขตด้านที่ "ผ่าน") ──
    name: "tolerance boundary: exactly 1 baht diff → passes (not > 1)",
    bill: { id: "b7", payments: [payment("p7", 1000)] },
    ocrMap: new Map([["p7", 1001]]),
    check: (reasons) => assert.deepEqual(reasons, []),
  },
  {
    // ── ขอบเขตอีกด้าน: diff เกิน 1 บาทไปนิดเดียว (1.01) → ต้องถูกแฟล็ก ──
    name: "tolerance boundary: 1.01 baht diff → flagged (> 1)",
    bill: { id: "b8", payments: [payment("p8", 1000)] },
    ocrMap: new Map([["p8", 1001.01]]),
    check: (reasons) => assert.equal(reasons.length, 1),
  },
  {
    // ── ทิศตรงข้าม: recorded สูงกว่า ocr — diff เท่ากับ 1 พอดี → ผ่าน, เกิน 1 → แฟล็ก ──
    name: "tolerance boundary (other direction): recorded higher, diff exactly 1 → passes",
    bill: { id: "b9", payments: [payment("p9", 1000)] },
    ocrMap: new Map([["p9", 999]]),
    check: (reasons) => assert.deepEqual(reasons, []),
  },
  {
    name: "tolerance boundary (other direction): recorded higher, diff 1.01 → flagged",
    bill: { id: "b10", payments: [payment("p10", 1000)] },
    ocrMap: new Map([["p10", 998.99]]),
    check: (reasons) => assert.equal(reasons.length, 1),
  },
  {
    // ── payment ไม่มีสลิปเลย (เงินสด/ไม่แนบ) → ไม่เข้าเช็คนี้ทุกประการ แม้ยอด OCR (ถ้ามี
    //    อยู่ใน map ด้วยเหตุผลอะไรก็ตาม) จะต่างกันลิบลับ ──
    name: "payment with no slipUrl (cash/no attachment) → never flagged, even with a wildly different OCR entry",
    bill: { id: "b11", payments: [payment("p11", 500, { slipUrl: null })] },
    ocrMap: new Map([["p11", 99999]]), // ไม่ควรถูกอ่านเลยเพราะ continue ก่อนถึงจุดเทียบยอด
    check: (reasons) => assert.deepEqual(reasons, []),
  },
  {
    // ── บิลไม่มี payment เลย → reasons ว่าง (sanity) ──
    name: "bill with zero payments → empty reasons",
    bill: { id: "b12", payments: [] },
    ocrMap: new Map(),
    check: (reasons) => assert.deepEqual(reasons, []),
  },
];

// NOTE: evaluateBillSlipGate() only ever compares amountThb vs the OCR-read
// amount (see ledger-push.ts:108-127) — it does NOT check any account-number
// field (ocrAccountNumber is used by the separate, older evaluatePaymentSlipMatch()
// per this file's module docblock, for the green/red dot popup — an intentionally
// different check). Confirmed by reading the function body; no account-number
// branch exists here, so there is nothing to test for it in this function.

async function main() {
  const { evaluateBillSlipGate } = await import("../ledger-push");

  let failed = 0;
  for (const c of CASES) {
    const reasons = evaluateBillSlipGate(c.bill, c.ocrMap);
    try {
      c.check(reasons);
      console.log(`  ✓ ${c.name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${c.name}`);
      console.error(`      ${err instanceof Error ? err.message : String(err)}`);
      console.error(`      reasons: ${JSON.stringify(reasons)}`);
    }
  }

  if (failed > 0) {
    console.error(`\nslip-gate: ${failed}/${CASES.length} case(s) FAILED`);
    process.exit(1);
  }
  console.log(`\nslip-gate: all ${CASES.length} cases passed`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
