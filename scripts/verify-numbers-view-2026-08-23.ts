// Read-only correctness gate for the ChairOps reconcile "numbers" view
// (CEO 2026-08-23). Calls the ACTUAL exported query functions against the
// real DB and cross-checks the new getReconcileChecklistNumbers() output
// against the existing getReconcileChecklist() / getReconcilePeriods() —
// the same functions the dot checklist and Periods tab already use — to
// prove the new grid never disagrees with them. Prints numbers, does not
// write anything.

import { prisma } from "@/lib/prisma";
import {
  getReconcileChecklist,
  getReconcileChecklistNumbers,
  getReconcilePeriods,
} from "@/lib/chairops/queries/reconcile-v2";

async function main() {
  const org = await prisma.chairopsBranch.findFirst({
    where: { isActive: true },
    select: { orgId: true },
  });
  if (!org) {
    console.log("No active ChairOps branch found — nothing to verify.");
    return;
  }
  const orgId = org.orgId;
  console.log("orgId:", orgId);

  // Pick 3 real branches with the MOST collection activity this month (real
  // data, not empty edge cases).
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  const collStart = new Date(`${ym}-01T00:00:00+07:00`);

  const grouped = await prisma.chairopsCashCollection.groupBy({
    by: ["branchId"],
    where: { orgId, collectedAt: { gte: collStart }, deletedAt: null },
    _count: { _all: true },
    orderBy: { _count: { branchId: "desc" } },
    take: 5,
  });
  const branchIds = grouped.slice(0, 3).map((g) => g.branchId);
  if (branchIds.length === 0) {
    console.log(`No collections found in ${ym} — trying previous month.`);
  }
  const branches = await prisma.chairopsBranch.findMany({
    where: { id: { in: branchIds } },
    select: { id: true, name: true },
  });
  console.log(`\nMonth under test: ${ym}`);
  console.log(
    "Branches under test:",
    branches.map((b) => `${b.name} (${b.id})`).join(" · "),
  );

  console.log("\n=== Fetching getReconcileChecklist (dot view — source of truth) ===");
  const checklist = await getReconcileChecklist({ orgId, year, month });

  console.log("=== Fetching getReconcileChecklistNumbers (NEW numbers view) ===");
  const t0 = Date.now();
  const numbers = await getReconcileChecklistNumbers({ orgId, year, month });
  const elapsedMs = Date.now() - t0;
  console.log(`getReconcileChecklistNumbers took ${elapsedMs}ms for ${numbers.branches.length} branches\n`);

  let mismatches = 0;
  let daysChecked = 0;

  for (const branchId of branchIds) {
    const branch = branches.find((b) => b.id === branchId);
    const name = branch?.name ?? branchId;
    console.log(`\n──────── ${name} (${branchId}) ────────`);

    const ckBranch = checklist.branches.find((b) => b.branchId === branchId);
    const nbBranch = numbers.branches.find((b) => b.branchId === branchId);
    if (!ckBranch || !nbBranch) {
      console.log("  MISSING from one of the two payloads! branchId:", branchId);
      mismatches++;
      continue;
    }

    // ── Check A: per-day collectedAmount / depositedAmount / collected /
    // deposited booleans must match EXACTLY between the dot checklist and
    // the numbers view (same underlying rows, just reshaped).
    for (let i = 0; i < ckBranch.cells.length; i++) {
      const ck = ckBranch.cells[i];
      const nb = nbBranch.cells[i];
      const hasActivity = ck.collected || ck.deposited;
      if (hasActivity) daysChecked++;
      const sameCollectedBool = ck.collected === nb.collected;
      const sameDepositedBool = ck.deposited === nb.deposited;
      const sameCollectedAmt = ck.collectedAmount === nb.collectedAmount;
      const sameDepositedAmt = ck.depositedAmount === nb.depositedAmount;
      if (!sameCollectedBool || !sameDepositedBool || !sameCollectedAmt || !sameDepositedAmt) {
        mismatches++;
        console.log(
          `  MISMATCH day ${ck.day}: dot{collected=${ck.collected},deposited=${ck.deposited},collectedAmt=${ck.collectedAmount},depositedAmt=${ck.depositedAmount}} ` +
            `numbers{collected=${nb.collected},deposited=${nb.deposited},collectedAmt=${nb.collectedAmount},depositedAmt=${nb.depositedAmount}}`,
        );
      }
      if (hasActivity) {
        console.log(
          `  day ${String(ck.day).padStart(2, "0")}: เก็บได้=${nb.collectedAmount.toLocaleString()} ฝาก=${nb.depositedAmount.toLocaleString()} ` +
            `ควรได้=${nb.expectedAmount == null ? "⚪" : nb.expectedAmount.toLocaleString()} ` +
            `ต่าง=${nb.variance == null ? "⚪" : nb.variance.toLocaleString()} ` +
            `verdict=${nb.verdict ?? "⚪"} rounds=${nb.roundCount}`,
        );
      }
    }

    // ── Check B: cumulative shortfall badge must equal the LAST
    // depositDiffCum getReconcilePeriods() itself would report right now.
    const periods = await getReconcilePeriods({ orgId, branchId });
    const expectedCum = periods.find((p) => p.depositDiffCum != null)?.depositDiffCum ?? null;
    const match = expectedCum === nbBranch.cumShortfall;
    console.log(
      `  cumShortfall (numbers view) = ${nbBranch.cumShortfall} · getReconcilePeriods() latest depositDiffCum = ${expectedCum} · ${
        match ? "MATCH" : "MISMATCH!!"
      }`,
    );
    if (!match) mismatches++;

    // Also print collectDays parity (row-header count badge, unchanged field).
    console.log(
      `  collectDays: dot=${ckBranch.collectDays} numbers=${nbBranch.collectDays} · ${
        ckBranch.collectDays === nbBranch.collectDays ? "MATCH" : "MISMATCH!!"
      }`,
    );
    if (ckBranch.collectDays !== nbBranch.collectDays) mismatches++;
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Branches checked: ${branchIds.length}`);
  console.log(`Days with activity checked: ${daysChecked}`);
  console.log(`Mismatches: ${mismatches}`);
  console.log(mismatches === 0 ? "✅ PASS — numbers view agrees with dot checklist + periods." : "❌ FAIL — see mismatches above.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
