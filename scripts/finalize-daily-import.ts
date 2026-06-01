// One-shot: finalize a pending ChairopsPosImport whose Vercel commit hit
// the 300-second function timeout. Same logic as commitImport() in
// app/(admin)/chairops/pos-ingest/actions.ts but optimized for tsx
// (no 5-min ceiling) and with bulk writes where possible.
//
// CEO 2026-06-01: the daily file (1012 resolved rows) timed out twice on
// Vercel commit. The unblock here is to run the same writes outside the
// serverless boundary so the CEO gets a committed file today, and the
// next push will speed up the server-action path so future commits fit
// inside 5 min on their own.
//
// Run: pnpm exec tsx -r dotenv/config \
//   scripts/finalize-daily-import.ts <importId> dotenv_config_path=.env.local

import { prisma } from "@/lib/prisma";

interface DiffRow {
  rowIndex: number;
  bizDate: string | null;
  chairCode: string | null;
  shopName: string | null;
  online: number;
  cash: number;
  coin: number;
  totalCash: number;
  totalRevenue: number;
  status: "new" | "same" | "changed" | "error";
  branchId: string | null;
  branchName: string | null;
  isPastDay: boolean;
}

interface DiffSummary {
  rows: DiffRow[];
  counts: { new: number; same: number; changed: number; error: number; total: number };
  starThing?: {
    aggregatedRows?: Array<{
      storeName: string;
      bizDate: string;
      cashTotal: number;
      onlineTotal: number;
      otherTotal: number;
      grossTotal: number;
      paymentCount: number;
      coinInsertCount: number;
      roundCount: number;
    }>;
    knownBranchEntries?: Array<[string, string]>;
  } | null;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.includes("dotenv_") && !a.endsWith(".ts"));
  const importId = args[0];
  if (!importId) {
    console.error("usage: finalize-daily-import.ts <importId>");
    process.exit(2);
  }

  const imp = await prisma.chairopsPosImport.findUnique({
    where: { id: importId },
    select: {
      id: true,
      orgId: true,
      filename: true,
      committed: true,
      uploadedById: true,
      diffSummary: true,
    },
  });
  if (!imp) { console.error("not found"); process.exit(3); }
  if (imp.committed) { console.error("already committed"); process.exit(4); }

  const diff = imp.diffSummary as unknown as DiffSummary;
  const orgId = imp.orgId;
  const sessionUserId = imp.uploadedById;

  const toApply = diff.rows
    .filter((r) => (r.status === "new" || r.status === "changed") && r.branchId && r.bizDate)
    .sort((a, b) => (a.bizDate ?? "").localeCompare(b.bizDate ?? ""));
  console.log(`importing ${toApply.length} rows · ${imp.filename}`);

  // Preload chairs + lastMove per chair
  const chairCodes = [...new Set(toApply.map((r) => r.chairCode).filter((c): c is string => !!c))];
  const chairs = chairCodes.length
    ? await prisma.chairopsChair.findMany({
        where: { orgId, chairCode: { in: chairCodes } },
        select: { id: true, chairCode: true, branchId: true },
      })
    : [];
  const moves = chairs.length
    ? await prisma.chairopsChairMove.groupBy({
        by: ["chairId"],
        where: { orgId, chairId: { in: chairs.map((c) => c.id) } },
        _max: { movedAt: true },
      })
    : [];
  const lastMoveByChairId = new Map<string, Date>(
    moves.map((m) => [m.chairId, m._max.movedAt] as const).filter((p): p is [string, Date] => p[1] != null),
  );
  const chairMap = new Map<string, { id: string; branchId: string; lastMoveAt: Date | null }>(
    chairs.map((c) => [c.chairCode, { id: c.id, branchId: c.branchId, lastMoveAt: lastMoveByChairId.get(c.id) ?? null }]),
  );

  // Preload all existing PosDaily rows in this batch's (branchId, chairCode, bizDate) space.
  const existingDaily = await prisma.chairopsPosDaily.findMany({
    where: {
      orgId,
      branchId: { in: [...new Set(toApply.map((r) => r.branchId!).filter(Boolean))] },
      bizDate: { in: [...new Set(toApply.map((r) => new Date(r.bizDate + "T00:00:00.000Z")))] },
    },
    select: { id: true, branchId: true, chairCode: true, bizDate: true },
  });
  const existingKey = (branchId: string, chairCode: string | null, bizDate: Date) =>
    `${branchId}|${chairCode ?? ""}|${bizDate.toISOString().slice(0, 10)}`;
  const existingMap = new Map<string, string>(
    existingDaily.map((e) => [existingKey(e.branchId, e.chairCode, e.bizDate), e.id]),
  );

  let chairsCreated = 0;
  let chairMovesLive = 0;
  let chairMovesHistorical = 0;
  let posDailyCreated = 0;
  let posDailyUpdated = 0;

  // No transaction wrapper · bulk-create new chairs + new moves + new posDaily.
  // We accept the risk of partial commit in trade for fitting inside reasonable wall time.

  // Step 1: new chairs in bulk
  const newChairData: Array<{ orgId: string; branchId: string; chairCode: string; isActive: boolean }> = [];
  const chairCodeToBranch = new Map<string, string>();
  for (const r of toApply) {
    if (!r.chairCode || chairMap.has(r.chairCode)) continue;
    if (chairCodeToBranch.has(r.chairCode)) continue;
    newChairData.push({ orgId, branchId: r.branchId!, chairCode: r.chairCode, isActive: true });
    chairCodeToBranch.set(r.chairCode, r.branchId!);
  }
  if (newChairData.length > 0) {
    await prisma.chairopsChair.createMany({ data: newChairData });
    // Re-fetch to get ids
    const fresh = await prisma.chairopsChair.findMany({
      where: { orgId, chairCode: { in: newChairData.map((c) => c.chairCode) } },
      select: { id: true, chairCode: true, branchId: true },
    });
    for (const f of fresh) {
      chairMap.set(f.chairCode, { id: f.id, branchId: f.branchId, lastMoveAt: null });
    }
    chairsCreated = newChairData.length;
  }

  // Step 2: chair moves
  const moveCreates: Array<{
    orgId: string;
    chairId: string;
    fromBranchId: string | null;
    toBranchId: string;
    movedAt: Date;
    movedById: string;
    source: string;
    notes: string;
  }> = [];
  const chairBranchUpdates: Array<{ chairId: string; toBranchId: string }> = [];
  const seenChairForFirstPlace = new Set<string>();
  for (const r of toApply) {
    if (!r.chairCode || !r.bizDate) continue;
    const bizDate = new Date(r.bizDate + "T00:00:00.000Z");
    const existing = chairMap.get(r.chairCode);
    if (!existing) continue;
    const wasJustCreated =
      newChairData.find((n) => n.chairCode === r.chairCode) && !seenChairForFirstPlace.has(r.chairCode);
    if (wasJustCreated) {
      moveCreates.push({
        orgId, chairId: existing.id, fromBranchId: null, toBranchId: r.branchId!,
        movedAt: bizDate, movedById: sessionUserId, source: "pos_ingest",
        notes: `first placement detected from POS upload (importId=${imp.id})`,
      });
      seenChairForFirstPlace.add(r.chairCode);
      continue;
    }
    if (existing.branchId !== r.branchId) {
      const isHistorical = existing.lastMoveAt != null && bizDate < existing.lastMoveAt;
      moveCreates.push({
        orgId, chairId: existing.id, fromBranchId: existing.branchId, toBranchId: r.branchId!,
        movedAt: bizDate, movedById: sessionUserId,
        source: isHistorical ? "pos_ingest_historical" : "pos_ingest",
        notes: isHistorical
          ? `historical placement (importId=${imp.id}) · chair.branchId NOT updated`
          : `branch change (importId=${imp.id})`,
      });
      if (!isHistorical) {
        chairBranchUpdates.push({ chairId: existing.id, toBranchId: r.branchId! });
        chairMap.set(r.chairCode, { id: existing.id, branchId: r.branchId!, lastMoveAt: bizDate });
        chairMovesLive += 1;
      } else {
        chairMovesHistorical += 1;
      }
    }
  }
  if (moveCreates.length > 0) {
    await prisma.chairopsChairMove.createMany({ data: moveCreates });
  }
  // Update chair branchId for live moves
  for (const u of chairBranchUpdates) {
    await prisma.chairopsChair.update({ where: { id: u.chairId }, data: { branchId: u.toBranchId } });
  }

  // Step 3: PosDaily upserts
  const newDailyData: Array<{
    orgId: string; branchId: string; chairCode: string | null; bizDate: Date;
    onlineTotal: number; cashTotal: number; coinInsertCount: number; totalCash: number; grossTotal: number;
    rawSource: string; importId: string; enteredById: string;
  }> = [];
  const updates: Array<{ id: string; data: object }> = [];
  for (const r of toApply) {
    if (!r.branchId || !r.bizDate) continue;
    const bizDate = new Date(r.bizDate + "T00:00:00.000Z");
    const key = existingKey(r.branchId, r.chairCode, bizDate);
    const existingId = existingMap.get(key);
    const data = {
      onlineTotal: r.online,
      cashTotal: r.cash,
      coinInsertCount: r.coin,
      totalCash: r.totalCash,
      grossTotal: r.totalRevenue,
      rawSource: "csv-upload" as const,
      importId: imp.id,
    };
    if (existingId) {
      updates.push({ id: existingId, data });
    } else {
      newDailyData.push({
        orgId, branchId: r.branchId, chairCode: r.chairCode, bizDate,
        ...data, enteredById: sessionUserId,
      });
    }
  }
  if (newDailyData.length > 0) {
    await prisma.chairopsPosDaily.createMany({ data: newDailyData });
    posDailyCreated = newDailyData.length;
  }
  for (const u of updates) {
    await prisma.chairopsPosDaily.update({ where: { id: u.id }, data: u.data });
    posDailyUpdated += 1;
  }

  // Step 4: BranchDailyRevenue aggregates (StarThing)
  let aggCreated = 0;
  const agg = diff.starThing;
  if (agg?.aggregatedRows && agg.knownBranchEntries) {
    const byName = new Map<string, string>(agg.knownBranchEntries);
    for (const row of agg.aggregatedRows) {
      const branchId = byName.get(row.storeName);
      if (!branchId) continue;
      const bizDate = new Date(`${row.bizDate}T00:00:00.000Z`);
      const existingAgg = await prisma.chairopsBranchDailyRevenue.findFirst({
        where: { orgId, branchId, bizDate }, select: { id: true },
      });
      const dailyData = {
        cashTotal: row.cashTotal, onlineTotal: row.onlineTotal, otherTotal: row.otherTotal,
        grossTotal: row.grossTotal, paymentCount: row.paymentCount,
        coinInsertCount: row.coinInsertCount, roundCount: row.roundCount, sourceImportId: imp.id,
      };
      if (existingAgg) {
        await prisma.chairopsBranchDailyRevenue.update({ where: { id: existingAgg.id }, data: dailyData });
      } else {
        await prisma.chairopsBranchDailyRevenue.create({ data: { ...dailyData, orgId, branchId, bizDate } });
      }
      aggCreated += 1;
    }
  }

  // Step 5: mark import committed
  await prisma.chairopsPosImport.update({
    where: { id: imp.id },
    data: { committed: true, committedAt: new Date() },
  });
  await prisma.chairopsAuditLog.create({
    data: {
      orgId, userId: sessionUserId,
      action: "pos_import.commit", entity: "PosImport", entityId: imp.id,
      newValue: {
        committed: true, appliedRows: toApply.length,
        chairsCreatedFromPos: chairsCreated,
        chairMovesRecorded: chairMovesLive,
        chairMovesHistoricalOnly: chairMovesHistorical,
        viaScript: "finalize-daily-import.ts",
      },
    },
  });

  console.log("");
  console.log("✅ FINALIZED");
  console.log(`  PosDaily created:   ${posDailyCreated}`);
  console.log(`  PosDaily updated:   ${posDailyUpdated}`);
  console.log(`  Chairs created:     ${chairsCreated}`);
  console.log(`  Chair moves live:   ${chairMovesLive}`);
  console.log(`  Chair moves hist:   ${chairMovesHistorical}`);
  console.log(`  BranchDailyRev:     ${aggCreated}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
