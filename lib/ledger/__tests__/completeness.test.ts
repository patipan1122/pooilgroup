// LedgerLine — unit tests for the input-VAT completeness engine.
// Contract: docs/PLAN_ledger_tax_invoice.md §3 (rule table) + §7 (test pass bar)
//           docs/WORKSHOP_ledgerline-tax-invoice.md (สเปค + กฎสี)
//
// HARD GATE (PLAN §7):
//   - ใบล่อ (lure) ทุกใบ -> red_invalid (zero false-accept)
//   - vat=0 -> ห้ามเขียว
//   - ใบกำกับอย่างย่อ -> เหลือง (yellow_partial)
//   - ชื่อผู้ซื้อผิดแต่เลขภาษีตรง -> ห้ามแดง (ตัดสินที่เลข 13 หลัก ไม่ใช่ชื่อ/confidence)
//
// The engine is DETERMINISTIC (no AI, no DB) so this test is pure — it imports
// recheck.ts directly (which only pulls in pure ./group-identity + ./types).
//
// RUNNER: the repo has no vitest/jest installed yet (only Playwright e2e).
//   - Once a runner exists:  npm i -D vitest  +  "test": "vitest run"
//     then:                  npx vitest run lib/ledger/__tests__/completeness.test.ts
//   - To run TODAY without adding a dep, use the companion script (same assertions):
//                            npx tsx lib/ledger/__tests__/completeness.run.ts
//
// The shared, runner-agnostic assertion logic lives in ./completeness.cases.ts so
// both entry points exercise exactly the same checks.

import { describe, it, expect } from "vitest";
import { cases, fixtures } from "./completeness.cases";

describe("gradeCompleteness — golden receipts (PLAN §3/§7) + HARD GATE (PLAN §7)", () => {
  it("fixture file has exactly 20 receipts incl. 3 lures", () => {
    expect(fixtures.length).toBe(20);
    expect(fixtures.filter((f) => f.name.startsWith("L")).length).toBe(3);
  });

  for (const c of cases) {
    it(c.name, () => {
      const err = c.check();
      if (err) throw new Error(err);
    });
  }
});
