// Apply 20260612210000_user_modules_add_ledger.sql — adds `ledger` (full list)
// to user_modules.module_name CHECK. Additive/idempotent.
// Run: pnpm exec tsx -r dotenv/config \
//   scripts/apply-user-modules-add-ledger.ts dotenv_config_path=.env.local
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

async function constraintDef(): Promise<string | null> {
  const rows = await prisma.$queryRaw<Array<{ def: string }>>`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conname = 'user_modules_module_name_check'`;
  return rows[0]?.def ?? null;
}

async function main() {
  console.log("BEFORE:", await constraintDef());

  const sql = readFileSync(
    "supabase/migrations/20260612210000_user_modules_add_ledger.sql",
    "utf8",
  );
  const stmts = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const s of stmts) {
    await prisma.$executeRawUnsafe(s);
  }

  const after = await constraintDef();
  console.log("AFTER:", after);
  console.log(
    after && after.includes("'ledger'")
      ? "✅ OK — 'ledger' now allowed"
      : "❌ FAIL — 'ledger' not in constraint",
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
