// Apply 20260614120000_cashhub_hotel_qr_bands.sql — adds qr_scan_total + qr_overnight
// to cashhub_hotel_daily (nullable, additive/idempotent) for shift-basis QR reconcile.
// Run: pnpm exec tsx -r dotenv/config \
//   scripts/apply-hotel-qr-bands.ts dotenv_config_path=.env.local
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";

async function cols(): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'cashhub_hotel_daily'
      AND column_name IN ('qr_scan_total','qr_overnight')`;
  return rows.map((r) => r.column_name).sort();
}

async function main() {
  console.log("BEFORE:", await cols());
  const sql = readFileSync(
    "supabase/migrations/20260614120000_cashhub_hotel_qr_bands.sql",
    "utf8",
  );
  const stmts = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const s of stmts) await prisma.$executeRawUnsafe(s);
  const after = await cols();
  console.log("AFTER:", after);
  console.log(
    after.includes("qr_scan_total") && after.includes("qr_overnight")
      ? "✅ OK — both columns present"
      : "❌ FAIL",
  );
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
