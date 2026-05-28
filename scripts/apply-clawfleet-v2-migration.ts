// One-shot: apply the ClawFleet v2 branch-model migration + verify.
// Run: npx tsx -r dotenv/config scripts/apply-clawfleet-v2-migration.ts dotenv_config_path=.env.local
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

async function main() {
  // 1. inspect existing enum type names (so our new enum matches Prisma's expectation)
  const enums = await prisma.$queryRaw<{ typname: string }[]>`
    SELECT t.typname FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname ILIKE 'cf%'
    GROUP BY t.typname`;
  console.log("EXISTING CF ENUM TYPES:", JSON.stringify(enums));

  // 2. apply the migration SQL
  const sql = readFileSync(
    "supabase/migrations/20260528000001_clawfleet_v2_branch_model.sql",
    "utf8",
  );
  await prisma.$executeRawUnsafe(sql);
  console.log("✅ migration applied");

  // 3. verify columns + table exist
  const sessCols = await prisma.$queryRaw<{ column_name: string; is_nullable: string }[]>`
    SELECT column_name, is_nullable FROM information_schema.columns
    WHERE table_name='cf_collection_sessions'
      AND column_name IN ('group_id','branch_id','expected_cash_cents','actual_cash_cents','cash_variance_bps','prize_meter_out','prize_counted_out','prize_variance')
    ORDER BY column_name`;
  const evtCol = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='cf_collection_events' AND column_name='photo_prize_meter_url'`;
  const deliv = await prisma.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='cf_deliveries'`;
  const delivEnum = await prisma.$queryRaw<{ typname: string }[]>`
    SELECT typname FROM pg_type WHERE typname='CfDeliveryStatus'`;

  console.log("SESSION COLS:", JSON.stringify(sessCols));
  console.log("EVENT photo_prize_meter_url:", JSON.stringify(evtCol));
  console.log("cf_deliveries table exists:", deliv[0]?.n === 1);
  console.log("CfDeliveryStatus enum exists:", delivEnum.length === 1);
  process.exit(0);
}
main().catch((e) => {
  console.error("❌ FAILED:", e);
  process.exit(1);
});
