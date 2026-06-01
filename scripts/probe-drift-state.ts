// Read-only probe: dump every ChairopsDrift row in prod so we can reconcile
// what the KPI box says vs what the table footer sums.
// CEO 2026-06-01: dashboard shows "DRIFT รวม +59,352" but table footer
// "−59,352" — figure out exactly which number is which.

import { prisma } from "@/lib/prisma";

async function main() {
  const drifts = await prisma.chairopsDrift.findMany({
    select: {
      branchId: true,
      driftAmount: true,
      posTotal: true,
      depositTotal: true,
      driftSince: true,
      branch: { select: { name: true, isActive: true } },
    },
    orderBy: { driftAmount: "desc" },
  });

  const active = drifts.filter((d) => d.branch?.isActive);
  let posSum = 0;
  let negSum = 0;
  let zero = 0;
  for (const d of active) {
    if (d.driftAmount > 0) posSum += d.driftAmount;
    else if (d.driftAmount < 0) negSum += d.driftAmount;
    else zero += 1;
  }
  console.log(`active branches with drift row: ${active.length}`);
  console.log(`  positive drifts (shortage)     SUM = ${posSum.toLocaleString()}`);
  console.log(`  negative drifts (surplus)      SUM = ${negSum.toLocaleString()}`);
  console.log(`  zero drift                       N = ${zero}`);
  console.log(`  signed net (positives+negatives) = ${(posSum + negSum).toLocaleString()}`);
  console.log("");
  console.log("top 5 positive (shortage · ค้างเก็บ):");
  for (const d of active.filter((d) => d.driftAmount > 0).slice(0, 5)) {
    console.log(`  ${d.branch?.name?.padEnd(40) ?? d.branchId} drift=+${d.driftAmount.toLocaleString()} POS=${d.posTotal.toLocaleString()} dep=${d.depositTotal.toLocaleString()}`);
  }
  console.log("");
  console.log("top 5 negative (surplus · ฝากเกิน · ผิดปกติ):");
  const negSorted = active.filter((d) => d.driftAmount < 0).sort((a, b) => a.driftAmount - b.driftAmount).slice(0, 5);
  for (const d of negSorted) {
    console.log(`  ${d.branch?.name?.padEnd(40) ?? d.branchId} drift=${d.driftAmount.toLocaleString()} POS=${d.posTotal.toLocaleString()} dep=${d.depositTotal.toLocaleString()}`);
  }
}

main().catch((e) => {
  console.error("probe failed:", e instanceof Error ? e.message : String(e));
  process.exit(1);
}).then(() => process.exit(0));
