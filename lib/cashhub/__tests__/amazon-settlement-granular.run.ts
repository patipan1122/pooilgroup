// Standalone runner for CashHub Amazon "qr" settlement-group split (qrapi/qrstd) tests —
// runs TODAY under tsx, no test framework needed:
//   npx tsx lib/cashhub/__tests__/amazon-settlement-granular.run.ts
// Exercises the exact same `cases` as amazon-settlement-granular.test.ts (vitest).
// Exits 1 on any failure. Mirrors lib/ledger/__tests__/reconcile-combo-match.run.ts pattern.

import { cases } from "./amazon-settlement-granular.cases";

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
  console.log(`\nCashHub Amazon "qr" settlement-group split (qrapi/qrstd) — ${pass}/${total} cases passed`);
  if (failures.length) {
    // eslint-disable-next-line no-console
    console.log("\n" + failures.join("\n") + "\n");
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(
    "  gate: posBreakdown ties out → exactly 2 rows (qrapi/qrstd) w/ correct fee math ✓ · " +
      "no posBreakdown → unchanged pre-2026-08-15 combined row ✓ · breakdown mismatch (full or " +
      "partial) → safe fallback to combined ✓ · legacy-ref cleanup targets only the old combined " +
      "shape actually replaced this send ✓\n",
  );
}

main();
