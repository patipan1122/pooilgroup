// ClawFleet reconcile — branch-led overview (CEO 2026-08-23: "เอาสาขานำหน้า").
// 1 query set (not per-branch N+1) → ตาราง "สาขา × มีพนักงานไหม × ผูกบัญชีไหม ×
// เก็บเงินล่าสุดกี่วันก่อน" ให้กดผูกบัญชีได้จากแถวเลย แทนที่จะเปิด dropdown เลือกสาขาก่อน.

import { prisma } from "@/lib/prisma";

export type BranchReconcileOverviewRow = {
  branchId: string;
  branchName: string;
  branchCode: string;
  staffCount: number;
  companyId: string | null;
  bankAccountId: string | null;
  lastCollectedAt: Date | null;
  lastCollectedLabel: string;
};

function daysAgoLabel(d: Date | null): string {
  if (!d) return "ยังไม่เคยเก็บ";
  const n = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (n <= 0) return "วันนี้";
  if (n === 1) return "เมื่อวาน";
  return `${n} วันก่อน`;
}

/** สรุปสถานะทุกสาขาตู้คีบในหน้าเดียว — สาขา นำหน้าเสมอ */
export async function getClawfleetReconcileOverview(
  orgId: string,
): Promise<BranchReconcileOverviewRow[]> {
  const branches = await prisma.branch.findMany({
    where: { orgId, businessType: "claw_machine", isActive: true },
    select: { id: true, name: true, code: true },
    orderBy: { code: "asc" },
  });
  const branchIds = branches.map((b) => b.id);
  if (branchIds.length === 0) return [];

  const [staffCounts, configs, lastCollected] = await Promise.all([
    prisma.userBranch.groupBy({
      by: ["branchId"],
      where: { branchId: { in: branchIds }, isActive: true },
      _count: { _all: true },
    }),
    prisma.cfBranchReconcileConfig.findMany({
      where: { orgId, branchId: { in: branchIds } },
      select: { branchId: true, companyId: true, bankAccountId: true },
    }),
    prisma.cfCollectionSession.groupBy({
      by: ["branchId"],
      where: { orgId, branchId: { in: branchIds } },
      _max: { openedAt: true },
    }),
  ]);

  const staffByBranch = new Map(staffCounts.map((s) => [s.branchId, s._count._all]));
  const configByBranch = new Map(configs.map((c) => [c.branchId, c]));
  const lastByBranch = new Map(
    lastCollected
      .filter((l): l is typeof l & { branchId: string } => l.branchId != null)
      .map((l) => [l.branchId, l._max.openedAt]),
  );

  return branches.map((b) => {
    const lastAt = lastByBranch.get(b.id) ?? null;
    const cfg = configByBranch.get(b.id);
    return {
      branchId: b.id,
      branchName: b.name,
      branchCode: b.code,
      staffCount: staffByBranch.get(b.id) ?? 0,
      companyId: cfg?.companyId ?? null,
      bankAccountId: cfg?.bankAccountId ?? null,
      lastCollectedAt: lastAt,
      lastCollectedLabel: daysAgoLabel(lastAt),
    };
  });
}
