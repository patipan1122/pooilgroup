// Standalone runner for the completeness engine tests — runs TODAY under tsx,
// no test framework needed:   npx tsx lib/ledger/__tests__/completeness.run.ts
// Exercises the exact same `cases` as completeness.test.ts (vitest). Exits 1 on
// any failure so it can gate CI later.

import { cases, fixtures } from "./completeness.cases";

function main(): void {
  // sanity on fixture count first (mirrors the vitest "fixture file" case)
  const lures = fixtures.filter((f) => f.name.startsWith("L")).length;
  const meta: string[] = [];
  if (fixtures.length !== 20) meta.push(`fixture count ${fixtures.length} ≠ 20`);
  if (lures !== 3) meta.push(`lure count ${lures} ≠ 3`);

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
  console.log(`\nLedgerLine completeness engine — ${pass}/${total} cases passed`);
  if (meta.length) {
    // eslint-disable-next-line no-console
    console.log("  meta warnings: " + meta.join("; "));
  }
  if (failures.length) {
    // eslint-disable-next-line no-console
    console.log("\n" + failures.join("\n") + "\n");
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log("  HARD GATE: lures all red ✓ · vat=0 never green ✓ · abbreviated yellow ✓ · name-wrong/id-right not red ✓\n");
  if (meta.length) process.exit(1);
}

main();
