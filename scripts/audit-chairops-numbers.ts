// Master accounting reconciliation probe · CEO 2026-06-01 goal:
// "ตรวจการเชื่อมโยงตัวเลขทุกอย่างบัญชี ระบบมันตเองความถูกต้อง 100%"
//
// Read-only. Walks every ChairOps numerical chain and flags any
// inconsistency between layers. Output: 1 line per check + final
// pass/fail summary.

import { prisma } from "@/lib/prisma";

type Issue = { sev: "P0" | "P1" | "P2"; check: string; detail: string };
const issues: Issue[] = [];

const fmt = (n: number) => n.toLocaleString("en-US");

async function main() {
  console.log("=".repeat(80));
  console.log("CHAIROPS ACCOUNTING RECONCILIATION AUDIT");
  console.log(`Run: ${new Date().toISOString()}`);
  console.log("=".repeat(80));

  // ── Check 1 · drift cache vs live derivation ───────────────────────
  console.log("\n[1] Drift cache vs live computation");
  const drifts = await prisma.chairopsDrift.findMany({
    select: {
      branchId: true,
      driftAmount: true,
      posTotal: true,
      depositTotal: true,
      branch: { select: { name: true, isActive: true, orgId: true } },
    },
  });
  for (const d of drifts.filter((d) => d.branch?.isActive)) {
    const livePos = await prisma.chairopsPosDaily.aggregate({
      where: { orgId: d.branch!.orgId, branchId: d.branchId },
      _sum: { grossTotal: true },
    });
    const liveDep = await prisma.chairopsCashDeposit.aggregate({
      where: { orgId: d.branch!.orgId, branchId: d.branchId },
      _sum: { depositedAmount: true, bankFee: true },
    });
    const livePosTotal = Number(livePos._sum.grossTotal ?? 0);
    const liveDepTotal =
      Number(liveDep._sum.depositedAmount ?? 0) + Number(liveDep._sum.bankFee ?? 0);
    const liveDrift = Math.round(livePosTotal - liveDepTotal);

    const cachedPos = d.posTotal;
    const cachedDep = d.depositTotal;
    const cachedDrift = d.driftAmount;

    if (Math.abs(liveDrift - cachedDrift) > 1) {
      issues.push({
        sev: "P0",
        check: "drift_cache_stale",
        detail: `${d.branch!.name}: cache=${fmt(cachedDrift)} live=${fmt(liveDrift)} Δ=${fmt(liveDrift - cachedDrift)}`,
      });
    }
    if (Math.abs(livePosTotal - cachedPos) > 1) {
      issues.push({
        sev: "P1",
        check: "drift_cache_pos_stale",
        detail: `${d.branch!.name}: cache.posTotal=${fmt(cachedPos)} live=${fmt(livePosTotal)}`,
      });
    }
  }
  console.log(`  checked ${drifts.filter((d) => d.branch?.isActive).length} active branches · ${issues.filter((i) => i.check.startsWith("drift_cache")).length} issues`);

  // ── Check 2 · PosDaily aggregate vs BranchDailyRevenue ─────────────
  console.log("\n[2] PosDaily sum vs BranchDailyRevenue (per branch · per day)");
  const branchDailyRows = await prisma.chairopsBranchDailyRevenue.findMany({
    select: { orgId: true, branchId: true, bizDate: true, grossTotal: true, cashTotal: true, onlineTotal: true, branch: { select: { name: true } } },
  });
  let bdrChecked = 0;
  let bdrIssues = 0;
  for (const b of branchDailyRows) {
    const posDailyAgg = await prisma.chairopsPosDaily.aggregate({
      where: { orgId: b.orgId, branchId: b.branchId, bizDate: b.bizDate },
      _sum: { grossTotal: true, cashTotal: true, onlineTotal: true },
    });
    const pdGross = Number(posDailyAgg._sum.grossTotal ?? 0);
    const bdrGross = Number(b.grossTotal);
    bdrChecked += 1;
    // Tolerance ฿2 per branch-day (rounding)
    if (Math.abs(pdGross - bdrGross) > 2) {
      bdrIssues += 1;
      if (bdrIssues <= 8) {
        issues.push({
          sev: "P1",
          check: "posdaily_vs_branchdaily_drift",
          detail: `${b.branch?.name ?? b.branchId} ${b.bizDate.toISOString().slice(0, 10)}: PosDaily.SUM=${fmt(pdGross)} BranchDailyRev=${fmt(bdrGross)} Δ=${fmt(pdGross - bdrGross)}`,
        });
      }
    }
  }
  console.log(`  checked ${bdrChecked} branch-day rows · ${bdrIssues} drift > ฿2`);

  // ── Check 3 · CashCollection → CashDeposit linkage ─────────────────
  console.log("\n[3] CashCollection.depositId integrity");
  const collections = await prisma.chairopsCashCollection.findMany({
    select: {
      id: true,
      depositId: true,
      countedAmount: true,
      depositedAmount: true,
      branch: { select: { name: true } },
      deposit: { select: { depositedAmount: true, bankFee: true } },
    },
  });
  let collWithStaleLegacy = 0;
  for (const c of collections) {
    // Wave-2 invariant: depositedAmount column is legacy; new deposit lives on .deposit relation
    if (c.deposit && c.depositedAmount > 0 && c.deposit.depositedAmount > 0) {
      const sumNew = c.deposit.depositedAmount + c.deposit.bankFee;
      // Both surfaces have value; should NEVER happen post-W2
      if (Math.abs(c.depositedAmount - sumNew) > 1) {
        collWithStaleLegacy += 1;
        if (collWithStaleLegacy <= 5) {
          issues.push({
            sev: "P1",
            check: "collection_dual_deposit",
            detail: `coll ${c.id.slice(0, 8)} ${c.branch?.name}: legacy.depositedAmount=${fmt(c.depositedAmount)} vs deposit.sum=${fmt(sumNew)}`,
          });
        }
      }
    }
  }
  console.log(`  checked ${collections.length} collections · ${collWithStaleLegacy} dual-deposit drift`);

  // ── Check 4 · Cash event meter monotonicity (per chair) ────────────
  console.log("\n[4] cashMeter monotonic per chair (cumulative · should never go backward)");
  const cashEventChairs = await prisma.chairopsPosCashEvent.groupBy({
    by: ["chairDeviceId"],
    _count: true,
  });
  let cashChecked = 0;
  let cashIssues = 0;
  for (const ch of cashEventChairs.slice(0, 100)) {
    const rows = await prisma.chairopsPosCashEvent.findMany({
      where: { chairDeviceId: ch.chairDeviceId },
      // Secondary sort by cashMeter resolves StarThing same-second ties
      // (timestamps are per-second; 2 events in same second are not rare).
      orderBy: [{ eventAt: "asc" }, { cashMeter: "asc" }],
      select: { eventAt: true, cashMeter: true },
    });
    let prev = -Infinity;
    for (const r of rows) {
      const meter = Number(r.cashMeter);
      if (meter < prev) {
        cashIssues += 1;
        if (cashIssues <= 5) {
          issues.push({
            sev: "P1",
            check: "cashmeter_non_monotonic",
            detail: `chair ${ch.chairDeviceId} at ${r.eventAt.toISOString()}: meter=${fmt(meter)} < prev=${fmt(prev)}`,
          });
        }
        break;
      }
      prev = meter;
    }
    cashChecked += 1;
  }
  console.log(`  checked ${cashChecked} chairs (sampled 100) · ${cashIssues} non-monotonic`);

  // ── Check 5 · Coin event meter monotonicity ─────────────────────────
  console.log("\n[5] coinMeter monotonic per chair");
  const coinEventChairs = await prisma.chairopsPosCoinEvent.groupBy({
    by: ["chairDeviceId"],
    _count: true,
  });
  let coinChecked = 0;
  let coinIssues = 0;
  for (const ch of coinEventChairs.slice(0, 100)) {
    const rows = await prisma.chairopsPosCoinEvent.findMany({
      where: { chairDeviceId: ch.chairDeviceId },
      orderBy: [{ eventAt: "asc" }, { coinMeter: "asc" }],
      select: { eventAt: true, coinMeter: true },
    });
    let prev = -Infinity;
    for (const r of rows) {
      const meter = Number(r.coinMeter);
      if (meter < prev) {
        coinIssues += 1;
        if (coinIssues <= 5) {
          issues.push({
            sev: "P1",
            check: "coinmeter_non_monotonic",
            detail: `chair ${ch.chairDeviceId} at ${r.eventAt.toISOString()}: meter=${fmt(meter)} < prev=${fmt(prev)}`,
          });
        }
        break;
      }
      prev = meter;
    }
    coinChecked += 1;
  }
  console.log(`  checked ${coinChecked} chairs (sampled 100) · ${coinIssues} non-monotonic`);

  // ── Check 6 · Chair branch consistency (chair.branchId vs latest ChairMove) ──
  console.log("\n[6] chair.branchId == latest ChairMove.toBranchId");
  const chairs = await prisma.chairopsChair.findMany({
    where: { isActive: true },
    select: { id: true, chairCode: true, branchId: true, orgId: true },
  });
  let chairChecked = 0;
  let chairIssues = 0;
  for (const c of chairs) {
    const latest = await prisma.chairopsChairMove.findFirst({
      where: { orgId: c.orgId, chairId: c.id },
      orderBy: { movedAt: "desc" },
      select: { toBranchId: true, movedAt: true },
    });
    chairChecked += 1;
    if (latest && latest.toBranchId !== c.branchId) {
      chairIssues += 1;
      if (chairIssues <= 5) {
        issues.push({
          sev: "P0",
          check: "chair_branch_diverged_from_move_ledger",
          detail: `chair ${c.chairCode}: chair.branchId=${c.branchId.slice(0, 8)}… latest move.toBranchId=${latest.toBranchId.slice(0, 8)}…`,
        });
      }
    }
  }
  console.log(`  checked ${chairChecked} active chairs · ${chairIssues} diverged`);

  // ── Check 7 · Unknown chair codes in PosDaily ──────────────────────
  console.log("\n[7] PosDaily.chairCode that does not exist in ChairopsChair");
  // ChairopsPosDaily has NO @@map → relation is PascalCase quoted.
  // (chairops_pos_cash_event / chairops_pos_coin_event DO have @@map, snake_case.)
  const orphanCount = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM chairops."ChairopsPosDaily" pd
    WHERE pd."chairCode" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM chairops."ChairopsChair" c
        WHERE c."chairCode" = pd."chairCode" AND c."orgId" = pd."orgId"
      )
  `;
  const orphans = orphanCount[0]?.count ?? 0;
  console.log(`  orphan PosDaily rows: ${orphans}`);
  if (orphans > 0) {
    issues.push({
      sev: "P2",
      check: "posdaily_orphan_chaircode",
      detail: `${orphans} PosDaily rows reference a chairCode not in ChairopsChair`,
    });
  }

  // ── Check 8 · Imports committed but no resulting PosDaily ──────────
  console.log("\n[8] Committed imports with no PosDaily / no event rows");
  const committedImports = await prisma.chairopsPosImport.findMany({
    where: { committed: true },
    select: { id: true, filename: true, dailyRevenue: { select: { id: true }, take: 1 }, cashEvents: { select: { id: true }, take: 1 }, coinEvents: { select: { id: true }, take: 1 } },
  });
  let zeroEffect = 0;
  for (const imp of committedImports) {
    if (imp.dailyRevenue.length === 0 && imp.cashEvents.length === 0 && imp.coinEvents.length === 0) {
      zeroEffect += 1;
      if (zeroEffect <= 5) {
        issues.push({
          sev: "P1",
          check: "import_committed_no_effect",
          detail: `${imp.filename} (${imp.id.slice(0, 8)}…) committed but wrote nothing to daily/cash/coin`,
        });
      }
    }
  }
  console.log(`  checked ${committedImports.length} committed imports · ${zeroEffect} wrote nothing`);

  // ── Check 9 · Active branches with NO assigned maid ────────────────
  console.log("\n[9] Active branches without an assigned maid (per memory chairops-maid-one-per-branch)");
  const activeBranches = await prisma.chairopsBranch.findMany({
    where: { isActive: true },
    select: { id: true, name: true, orgId: true },
  });
  let noMaid = 0;
  for (const b of activeBranches) {
    const maid = await prisma.chairopsUser.findFirst({
      where: { orgId: b.orgId, primaryBranchId: b.id, role: "MAID", isActive: true },
      select: { id: true },
    });
    if (!maid) {
      noMaid += 1;
      if (noMaid <= 5) {
        issues.push({
          sev: "P2",
          check: "branch_no_maid",
          detail: `branch "${b.name}" active but has no MAID assigned`,
        });
      }
    }
  }
  console.log(`  checked ${activeBranches.length} active branches · ${noMaid} have no maid`);

  // ── Summary ──────────────────────────────────────────────────────────
  console.log("");
  console.log("=".repeat(80));
  console.log(`AUDIT COMPLETE · ${issues.length} issues found`);
  console.log("=".repeat(80));
  const bySev = { P0: 0, P1: 0, P2: 0 };
  for (const i of issues) bySev[i.sev] += 1;
  console.log(`  P0 (correctness · MUST FIX): ${bySev.P0}`);
  console.log(`  P1 (drift / staleness):      ${bySev.P1}`);
  console.log(`  P2 (data hygiene):           ${bySev.P2}`);
  console.log("");
  if (issues.length > 0) {
    console.log("Top 20 issues:");
    for (const i of issues.slice(0, 20)) {
      console.log(`  [${i.sev}] ${i.check} · ${i.detail}`);
    }
  }
  console.log("");
  process.exit(bySev.P0 > 0 ? 2 : bySev.P1 > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("AUDIT FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(3);
});
