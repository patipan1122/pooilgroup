// Read-only probe: report cash event column type + current max values.
// Audit P1 follow-up — if cashAdded/cashMeter is Decimal(12, 2), max is
// 10^10 - 1 = 99,999,999,999.99. If we ever see a meter close to that,
// schedule a BIGINT or Decimal(18, 2) migration.
//
// Run: pnpm exec tsx -r dotenv/config scripts/probe-cash-event-column.ts \
//   dotenv_config_path=.env.local

import { prisma } from "@/lib/prisma";

async function main() {
  const cols = await prisma.$queryRaw<
    Array<{
      column_name: string;
      data_type: string;
      numeric_precision: number | null;
      numeric_scale: number | null;
    }>
  >`
    SELECT column_name, data_type, numeric_precision, numeric_scale
    FROM information_schema.columns
    WHERE table_schema = 'chairops'
      AND table_name = 'chairops_pos_cash_event'
      AND column_name IN ('cashAdded', 'cashMeter')
    ORDER BY column_name
  `;

  console.log("=== chairops.chairops_pos_cash_event column types ===");
  for (const c of cols) {
    console.log(
      `  ${c.column_name.padEnd(12)} → ${c.data_type}` +
        (c.numeric_precision
          ? ` (${c.numeric_precision},${c.numeric_scale ?? 0})`
          : ""),
    );
  }

  const max = await prisma.chairopsPosCashEvent.aggregate({
    _max: { cashAdded: true, cashMeter: true },
  });
  console.log("\nMAX values currently in prod:");
  console.log(`  cashAdded: ${max._max.cashAdded?.toString() ?? "—"}`);
  console.log(`  cashMeter: ${max._max.cashMeter?.toString() ?? "—"}`);

  const meterStr = max._max.cashMeter?.toString() ?? "0";
  const meterDigits = meterStr.replace(/\D/g, "").length;
  const safeDigits = 12 - 2; // Decimal(12,2) = 10 integer digits
  if (meterDigits > safeDigits) {
    console.log(`\n❌ OVERFLOW IMMINENT · meter has ${meterDigits} integer digits, schema allows ${safeDigits}`);
    process.exit(1);
  }
  console.log(
    `\n✅ Within Decimal(12, 2) bounds · ${meterDigits} integer digits (max ${safeDigits})`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("probe failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
