// Apply the BIGINT migration for chairops.chairops_pos_coin_event.
// Same pattern as scripts/apply-clawfleet-v2-migration.ts — reads the
// canonical migration SQL from prisma/migrations/ and executes it via
// $executeRawUnsafe. Idempotent: ALTER ... TYPE BIGINT on a bigint column
// is a no-op.
//
// Run: pnpm exec tsx -r dotenv/config \
//   scripts/apply-coin-event-bigint-migration.ts dotenv_config_path=.env.local

import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

async function main() {
  // 1. before
  const before = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'chairops'
      AND table_name = 'chairops_pos_coin_event'
      AND column_name IN ('coinAdded', 'coinMeter')
    ORDER BY column_name`;
  console.log("BEFORE:", JSON.stringify(before));

  // 2. apply
  const sql = readFileSync(
    "prisma/migrations/20260601_coin_event_bigint.sql",
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

  // 3. after
  const after = await prisma.$queryRaw<Array<{ column_name: string; data_type: string }>>`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'chairops'
      AND table_name = 'chairops_pos_coin_event'
      AND column_name IN ('coinAdded', 'coinMeter')
    ORDER BY column_name`;
  console.log("AFTER:", JSON.stringify(after));

  const ok = after.every((r) => r.data_type === "bigint");
  console.log(ok ? "✅ migration applied" : "❌ verification failed");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("❌ FAILED:", e);
  process.exit(2);
});
