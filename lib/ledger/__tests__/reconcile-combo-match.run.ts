// Standalone runner for findBankCombo (N:1 bank-line matching) AND findBookCombo
// (1:M — reverse direction, bank-recon Pass 3) tests — runs TODAY under tsx, no test
// framework needed:
//   npx tsx lib/ledger/__tests__/reconcile-combo-match.run.ts
// Exercises the exact same `cases` as reconcile-combo-match.test.ts (vitest).
// Exits 1 on any failure. Mirrors completeness.run.ts pattern.

import { cases } from "./reconcile-combo-match.cases";

function main(): void {
  const failures: string[] = [];
  let pass = 0;
  for (const c of cases) {
    let err: string | null;
    try {
      err = c.check();
    } catch (e) {
      err = (e as Error).message;
    }
    if (err) failures.push(`  ✗ ${c.name}\n      ${err}`);
    else pass++;
  }

  const total = cases.length;
  // eslint-disable-next-line no-console
  console.log(`\nLedgerLine N:1 combo matcher (findBankCombo) — ${pass}/${total} cases passed`);
  if (failures.length) {
    // eslint-disable-next-line no-console
    console.log("\n" + failures.join("\n") + "\n");
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(
    "  gate: 2-line sum ✓ · 3-line sum (only when no pair) ✓ · ambiguous pairs never guess ✓ · " +
      "opposite-sign/name-lock/date-window/tolerance/cap all reuse 1:1 rules ✓ · findBookCombo " +
      "(pass 3) 2/3-line book sums ✓ · ambiguous within AND across concepts never guess ✓ · " +
      "pass 2 (findBankCombo) unaffected by pass 3 addition ✓\n",
  );
}

main();
