// Standalone runner for conceptForChannel/bankNameMatches tests — runs TODAY under tsx:
//   npx tsx lib/ledger/__tests__/reconcile-match-keywords.run.ts
// Mirrors reconcile-combo-match.run.ts pattern.

import { cases } from "./reconcile-match-keywords.cases";

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
  console.log(`\nLedgerLine concept matcher (conceptForChannel/bankNameMatches) — ${pass}/${total} cases passed`);
  if (failures.length) {
    console.log("\n" + failures.join("\n") + "\n");
    process.exit(1);
  }
}

main();
