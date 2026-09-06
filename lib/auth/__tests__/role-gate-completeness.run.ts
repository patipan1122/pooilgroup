// Standalone runner for the role-gate completeness scan — runs TODAY under
// tsx, no test framework needed:
//   npx tsx lib/auth/__tests__/role-gate-completeness.run.ts
// Exercises the exact same `cases` as role-gate-completeness.test.ts (vitest).
// Exits 1 on any failure — wired into .github/workflows/ci.yml as a required
// step so this bug class (a role gets added but a hand-rolled array/
// requireRole() call forgets it) can't silently ship again.

import { cases } from "./role-gate-completeness.cases";

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
  console.log(`\nrole-gate completeness — ${pass}/${total} sites OK`);

  if (failures.length) {
    // eslint-disable-next-line no-console
    console.log("\n" + failures.join("\n") + "\n");
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log("  every multi-role gate found includes the full admin tier (or is a documented exception)\n");
}

main();
