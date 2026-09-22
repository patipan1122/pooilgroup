// One-shot: apply the ChairOps deposit-slip-attachment table migration + verify.
// Run: npx tsx -r dotenv/config scripts/apply-chairops-deposit-slip-attachments-migration.ts dotenv_config_path=.env.local
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

async function main() {
  const sql = readFileSync(
    "prisma/migrations/20260922120000_chairops_deposit_slip_attachments/migration.sql",
    "utf8",
  );
  await prisma.$executeRawUnsafe(sql);
  console.log("✅ migration applied");

  const table = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM information_schema.tables
    WHERE table_schema = 'chairops' AND table_name = 'ChairopsDepositSlipAttachment'`;
  const cols = await prisma.$queryRaw<{ column_name: string; is_nullable: string }[]>`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_schema = 'chairops' AND table_name = 'ChairopsDepositSlipAttachment'
    ORDER BY column_name`;
  const fk = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM information_schema.table_constraints
    WHERE table_schema = 'chairops'
      AND table_name = 'ChairopsDepositSlipAttachment'
      AND constraint_type = 'FOREIGN KEY'`;

  console.log("table exists:", table[0]?.n === 1);
  console.log("columns:", JSON.stringify(cols));
  console.log("foreign key constraints:", fk[0]?.n);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("❌ migration failed:", e);
    process.exit(1);
  });
