// CashHub Amazon — unit tests for the "qr" settlement-group split into qrapi/qrstd, plus the
// 3rd "qrcredit" POS_EXTRACT_GROUPS split (QRCredit(API) + blueplus+ credit(API))
// (computeSendRows split decision, legacyRefsForDay). Pure (no DB).
//
// RUNNER: this repo has no vitest/jest installed yet (only Playwright e2e) — see
//   lib/ledger/__tests__/completeness.test.ts for the same caveat.
//   - Once a runner exists:  npm i -D vitest  +  "test": "vitest run"
//     then:                  npx vitest run lib/cashhub/__tests__/amazon-settlement-granular.test.ts
//   - To run TODAY without adding a dep, use the companion script (same assertions):
//                            npx tsx lib/cashhub/__tests__/amazon-settlement-granular.run.ts
//
// The shared, runner-agnostic assertion logic lives in ./amazon-settlement-granular.cases.ts
// so both entry points exercise exactly the same checks.

import { describe, it } from "vitest";
import { cases } from "./amazon-settlement-granular.cases";

describe("CashHub Amazon qr-group split into qrapi/qrstd + qrcredit extraction (money-safe: no split when it doesn't tie out)", () => {
  for (const c of cases) {
    it(c.name, () => {
      const err = c.check();
      if (err) throw new Error(err);
    });
  }
});
