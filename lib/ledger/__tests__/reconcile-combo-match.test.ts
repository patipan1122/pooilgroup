// LedgerLine — unit tests for findBankCombo (N:1 auto-match combination search).
// Pure (no DB) so this test only imports reconcile-combo-match.ts + reconcile-match-keywords.ts.
//
// RUNNER: this repo has no vitest/jest installed yet (only Playwright e2e) — see
//   lib/ledger/__tests__/completeness.test.ts for the same caveat.
//   - Once a runner exists:  npm i -D vitest  +  "test": "vitest run"
//     then:                  npx vitest run lib/ledger/__tests__/reconcile-combo-match.test.ts
//   - To run TODAY without adding a dep, use the companion script (same assertions):
//                            npx tsx lib/ledger/__tests__/reconcile-combo-match.run.ts
//
// The shared, runner-agnostic assertion logic lives in ./reconcile-combo-match.cases.ts
// so both entry points exercise exactly the same checks.

import { describe, it } from "vitest";
import { cases } from "./reconcile-combo-match.cases";

describe("findBankCombo — N:1 bank-line combination matching (money-safe: no guessing on ambiguity)", () => {
  for (const c of cases) {
    it(c.name, () => {
      const err = c.check();
      if (err) throw new Error(err);
    });
  }
});
