// Role-gate completeness — vitest entry point.
// Contract: every requireRole()/role-array gate that already lists 2+
// admin-tier roles must list ALL of them (super_admin/org_admin/admin/
// program_admin), unless justified in lib/auth/role-gate-known-exceptions.ts.
// See role-gate-completeness.cases.ts for the full rationale + scan design.
//
// RUNNER: the repo has no vitest/jest installed yet (only Playwright e2e).
//   - Once a runner exists:  npm i -D vitest  +  "test": "vitest run"
//     then:                  npx vitest run lib/auth/__tests__/role-gate-completeness.test.ts
//   - To run TODAY without adding a dep (this is what CI actually runs):
//                            npx tsx lib/auth/__tests__/role-gate-completeness.run.ts
//
// The shared, runner-agnostic scan + assertion logic lives in
// ./role-gate-completeness.cases.ts so both entry points exercise exactly the
// same checks. (Types-only `vitest` ambient module shim already exists at
// lib/ledger/__tests__/vitest-shim.d.ts and applies repo-wide.)

import { describe, it } from "vitest";
import { cases } from "./role-gate-completeness.cases";

describe("role-gate completeness — every admin-tier role array includes program_admin (or is a documented exception)", () => {
  for (const c of cases) {
    it(c.name, () => {
      const err = c.check();
      if (err) throw new Error(err);
    });
  }
});
