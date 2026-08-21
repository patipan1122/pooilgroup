// LedgerLine — unit tests for conceptForChannel/bankNameMatches.
// Pure (no DB). RUNNER: see reconcile-combo-match.test.ts for the same no-vitest-yet caveat —
// use `npx tsx lib/ledger/__tests__/reconcile-match-keywords.run.ts` to run today.

import { describe, it } from "vitest";
import { cases } from "./reconcile-match-keywords.cases";

describe("conceptForChannel/bankNameMatches — channel-to-concept routing", () => {
  for (const c of cases) {
    it(c.name, () => {
      const err = c.check();
      if (err) throw new Error(err);
    });
  }
});
