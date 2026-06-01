// Read-only probe: report the actual Postgres column type for
// chairops.chairops_pos_coin_event.{coinAdded,coinMeter}. No writes. No
// secrets printed. Used to confirm whether the BIGINT migration has
// reached prod yet (or has been applied via the in-app one-click runner).
//
// Run: pnpm exec tsx -r dotenv/config scripts/probe-coin-event-column-type.ts
//   dotenv_config_path=.env.local

import { prisma } from "@/lib/prisma";

async function main() {
  const rows = await prisma.$queryRaw<
    Array<{ column_name: string; data_type: string }>
  >`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'chairops'
      AND table_name = 'chairops_pos_coin_event'
      AND column_name IN ('coinAdded', 'coinMeter')
    ORDER BY column_name
  `;

  if (rows.length === 0) {
    console.log("⚠ table chairops.chairops_pos_coin_event NOT FOUND — events feature hasn't reached this DB at all");
    process.exit(2);
  }

  console.log("=== chairops.chairops_pos_coin_event column types ===");
  for (const r of rows) {
    const flag = r.data_type === "bigint" ? "✅" : r.data_type === "integer" ? "❌" : "?";
    console.log(`  ${flag} ${r.column_name.padEnd(12)} → ${r.data_type}`);
  }

  const allBigInt = rows.every((r) => r.data_type === "bigint");
  if (allBigInt) {
    console.log("\n✅ BIGINT migration HAS been applied — coin commit will work.");
    process.exit(0);
  } else {
    console.log("\n❌ Migration NOT yet applied — coin commit will fail for any meter > 2,147,483,647.");
    console.log("   Run via /chairops/pos-ingest 1-click button OR paste SQL into Supabase SQL Editor.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("probe failed:", e instanceof Error ? e.message : String(e));
  process.exit(3);
});
