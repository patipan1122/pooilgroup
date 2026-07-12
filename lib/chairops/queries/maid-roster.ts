// Maid roster queries (BF1).
//
// Used by:
//   - /chairops/maids                 (list view)
//   - /chairops/maids/[userId]        (detail view)
//   - /chairops/maids/[userId]/pay    (pay calendar)
//
// All reads filtered by orgId (multi-tenant lock) · React `cache()` for
// per-request memo.

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type {
  MaidRosterRow,
  MaidRosterStatus,
  LeaveHistoryRow,
  PayHistoryRow,
  AssignmentHistoryRow,
  BranchRosterView,
  BranchRosterGroup,
  MaidInBranch,
} from "@/app/(admin)/chairops/(office)/maids/types";

function bkkYmd(): string {
  const tz = process.env.APP_TIMEZONE || "Asia/Bangkok";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function bkkToday(): Date {
  // Midnight of the Bangkok calendar date, expressed as a UTC @db.Date value.
  // Used for ChairopsMaidDayOff.date / ChairopsMaidDailyPay.date (both @db.Date).
  return new Date(`${bkkYmd()}T00:00:00Z`);
}

// [start, end) UTC window covering "today" in Bangkok — for timestamp columns
// (collectedAt / depositedAt / reportedAt). Bangkok is UTC+7 so the day starts
// at 17:00 UTC the previous day.
function bkkTodayRange(): { start: Date; end: Date } {
  const ymd = bkkYmd();
  const start = new Date(`${ymd}T00:00:00+07:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function firstOfMonthBkk(): Date {
  const tz = process.env.APP_TIMEZONE || "Asia/Bangkok";
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${ymd.slice(0, 7)}-01T00:00:00Z`);
}

export const listMaidRoster = cache(async function listMaidRoster(
  orgId: string,
): Promise<MaidRosterRow[]> {
  const today = bkkToday();
  const monthStart = firstOfMonthBkk();

  // 1. Pull every MAID + every branch in one shot (small data).
  const [maids, branches, leavesToday, payAgg, leaveMonthAgg, branchCounts] =
    await Promise.all([
    prisma.chairopsUser.findMany({
      where: { orgId, role: "MAID" },
      select: {
        id: true,
        displayName: true,
        phone: true,
        primaryBranchId: true,
        isActive: true,
      },
      orderBy: { displayName: "asc" },
    }),
    prisma.chairopsBranch.findMany({
      where: { orgId, isActive: true },
      select: { id: true, name: true },
    }),
    prisma.chairopsMaidDayOff.findMany({
      where: { orgId, date: today },
      select: { maidId: true, reason: true },
    }),
    prisma.chairopsMaidDailyPay.groupBy({
      by: ["maidId"],
      where: { orgId, date: { gte: monthStart } },
      _sum: { amount: true },
    }),
    prisma.chairopsMaidDayOff.groupBy({
      by: ["maidId"],
      where: { orgId, date: { gte: monthStart } },
      _count: { _all: true },
    }),
    // multi-branch (CEO 2026-07-08): how many branches each maid actively manages.
    prisma.chairopsMaidAssignment.groupBy({
      by: ["userId"],
      where: { orgId, isActive: true, endedAt: null },
      _count: { _all: true },
    }),
  ]);

  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));
  const branchCountByMaid = new Map(
    branchCounts.map((c) => [c.userId, c._count._all]),
  );
  const leaveTodayByMaid = new Map(
    leavesToday.map((l) => [l.maidId, l.reason ?? ""]),
  );
  const payByMaid = new Map(
    payAgg.map((p) => [p.maidId, p._sum.amount ?? 0]),
  );
  const leaveCountByMaid = new Map(
    leaveMonthAgg.map((l) => [l.maidId, l._count._all]),
  );

  const rows: MaidRosterRow[] = maids.map((m) => {
    const branchName = m.primaryBranchId
      ? branchNameById.get(m.primaryBranchId) ?? null
      : null;
    const todayLeave = leaveTodayByMaid.get(m.id);
    const status: MaidRosterStatus = !m.isActive
      ? "disabled"
      : !m.primaryBranchId
        ? "no_slot"
        : todayLeave !== undefined
          ? "on_leave"
          : "working";
    return {
      userId: m.id,
      displayName: m.displayName,
      phone: m.phone,
      branchId: m.primaryBranchId,
      branchName,
      status,
      todayDayOffReason: todayLeave === "" ? null : todayLeave ?? null,
      thisMonthPaid: payByMaid.get(m.id) ?? 0,
      daysOffThisMonth: leaveCountByMaid.get(m.id) ?? 0,
      branchCount: branchCountByMaid.get(m.id) ?? (m.primaryBranchId ? 1 : 0),
    };
  });

  return rows;
});

// Branch-first roster (CEO 2026-07-12) — "ดูตามสาขา". Groups every ACTIVE
// branch → the maids covering it (via active assignments ∪ primaryBranchId),
// with each maid's full today-status (leave / collected / deposited / cleaned).
// Empty branches are kept (so "ไม่มีแม่บ้าน" is visible) and active maids with
// no branch at all are surfaced separately so nothing is hidden.
export const listMaidRosterByBranch = cache(async function listMaidRosterByBranch(
  orgId: string,
): Promise<BranchRosterView> {
  const today = bkkToday();
  const { start, end } = bkkTodayRange();

  const [maids, branches, assignments, leavesToday, collToday, depToday, cleanToday] =
    await Promise.all([
      prisma.chairopsUser.findMany({
        where: { orgId, role: "MAID", isActive: true },
        select: { id: true, displayName: true, phone: true, primaryBranchId: true },
        orderBy: { displayName: "asc" },
      }),
      prisma.chairopsBranch.findMany({
        where: { orgId, isActive: true },
        select: { id: true, name: true, tabName: true },
        orderBy: { name: "asc" },
      }),
      prisma.chairopsMaidAssignment.findMany({
        where: { orgId, isActive: true, endedAt: null },
        select: { userId: true, branchId: true },
      }),
      prisma.chairopsMaidDayOff.findMany({
        where: { orgId, date: today },
        select: { maidId: true, reason: true },
      }),
      // today's cash collections (exclude soft-deleted) — count + latest time per maid+branch
      prisma.chairopsCashCollection.findMany({
        where: { orgId, deletedAt: null, collectedAt: { gte: start, lt: end } },
        select: { maidId: true, branchId: true, collectedAt: true },
      }),
      prisma.chairopsCashDeposit.findMany({
        where: { orgId, depositedAt: { gte: start, lt: end } },
        select: { maidId: true, branchId: true },
      }),
      prisma.chairopsCleanlinessReport.findMany({
        where: { orgId, reportedAt: { gte: start, lt: end } },
        select: { byMaidId: true, branchId: true },
      }),
    ]);

  const leaveByMaid = new Map(leavesToday.map((l) => [l.maidId, l.reason ?? ""]));

  // maid+branch keyed today-activity aggregates
  const collKey = (maidId: string, branchId: string) => `${maidId}::${branchId}`;
  const collAgg = new Map<string, { count: number; last: Date }>();
  for (const c of collToday) {
    const k = collKey(c.maidId, c.branchId);
    const cur = collAgg.get(k);
    if (!cur) collAgg.set(k, { count: 1, last: c.collectedAt });
    else {
      cur.count += 1;
      if (c.collectedAt > cur.last) cur.last = c.collectedAt;
    }
  }
  const depSet = new Set(depToday.map((d) => collKey(d.maidId, d.branchId)));
  const cleanSet = new Set(cleanToday.map((c) => collKey(c.byMaidId, c.branchId)));

  // maid → set of branchIds they cover (assignments ∪ primary). Also count how
  // many total branches each maid covers (for the "+N สาขา" hint).
  const branchIdSet = new Set(branches.map((b) => b.id));
  const maidBranches = new Map<string, Set<string>>();
  for (const m of maids) maidBranches.set(m.id, new Set());
  for (const a of assignments) {
    if (branchIdSet.has(a.branchId)) maidBranches.get(a.userId)?.add(a.branchId);
  }
  for (const m of maids) {
    if (m.primaryBranchId && branchIdSet.has(m.primaryBranchId)) {
      maidBranches.get(m.id)?.add(m.primaryBranchId);
    }
  }

  const groups: BranchRosterGroup[] = branches.map((b) => {
    const maidsHere: MaidInBranch[] = [];
    for (const m of maids) {
      const set = maidBranches.get(m.id);
      if (!set || !set.has(b.id)) continue;
      const coll = collAgg.get(collKey(m.id, b.id));
      const leave = leaveByMaid.get(m.id);
      maidsHere.push({
        userId: m.id,
        displayName: m.displayName,
        phone: m.phone,
        isPrimary: m.primaryBranchId === b.id,
        otherBranchCount: Math.max(0, (set?.size ?? 1) - 1),
        onLeave: leave !== undefined,
        leaveReason: leave ? leave : null,
        collectedCount: coll?.count ?? 0,
        collectedLastAt: coll?.last.toISOString() ?? null,
        deposited: depSet.has(collKey(m.id, b.id)),
        cleaned: cleanSet.has(collKey(m.id, b.id)),
      });
    }
    // home maid first, then by name
    maidsHere.sort((a, c) =>
      a.isPrimary === c.isPrimary
        ? a.displayName.localeCompare(c.displayName, "th")
        : a.isPrimary
          ? -1
          : 1,
    );
    return { branchId: b.id, branchName: b.name, tabName: b.tabName, maids: maidsHere };
  });

  const unassignedMaids = maids
    .filter((m) => (maidBranches.get(m.id)?.size ?? 0) === 0)
    .map((m) => ({ userId: m.id, displayName: m.displayName, phone: m.phone }));

  // count of unique maids on leave today (that are actually assigned somewhere)
  const onLeaveAssigned = new Set<string>();
  for (const g of groups)
    for (const m of g.maids) if (m.onLeave) onLeaveAssigned.add(m.userId);

  return {
    branches: groups,
    unassignedMaids,
    branchesWithoutMaid: groups.filter((g) => g.maids.length === 0).length,
    onLeaveToday: onLeaveAssigned.size,
  };
});

export const getMaidDetail = cache(async function getMaidDetail(
  orgId: string,
  userId: string,
) {
  const [maid, leaves, pay, assignments] = await Promise.all([
    prisma.chairopsUser.findFirst({
      where: { id: userId, orgId, role: "MAID" },
      select: {
        id: true,
        displayName: true,
        phone: true,
        email: true,
        lineUserId: true,
        primaryBranchId: true,
        isActive: true,
        createdAt: true,
        // payroll / HR (CEO 2026-06-03)
        bankName: true,
        bankAccountNo: true,
        bankAccountName: true,
        contractFileUrl: true,
        contractFileName: true,
      },
    }),
    prisma.chairopsMaidDayOff.findMany({
      where: { orgId, maidId: userId },
      orderBy: { date: "desc" },
      take: 90,
      include: { createdBy: { select: { displayName: true } } },
    }),
    prisma.chairopsMaidDailyPay.findMany({
      where: { orgId, maidId: userId },
      orderBy: { date: "desc" },
      take: 365,
      include: { paidBy: { select: { displayName: true } } },
    }),
    prisma.chairopsMaidAssignment.findMany({
      where: { orgId, userId },
      orderBy: { startedAt: "desc" },
      take: 20,
      include: { branch: { select: { name: true } } },
    }),
  ]);

  if (!maid) return null;

  const leaveRows: LeaveHistoryRow[] = leaves.map((l) => ({
    id: l.id,
    date: l.date.toISOString().slice(0, 10),
    reason: l.reason,
    createdByName: l.createdBy.displayName,
    createdAt: l.createdAt.toISOString(),
  }));
  const payRows: PayHistoryRow[] = pay.map((p) => ({
    id: p.id,
    date: p.date.toISOString().slice(0, 10),
    amount: p.amount,
    note: p.note,
    paidByName: p.paidBy.displayName,
    paidAt: p.paidAt.toISOString(),
  }));
  const assignmentRows: AssignmentHistoryRow[] = assignments.map((a) => ({
    id: a.id,
    branchId: a.branchId,
    branchName: a.branch.name,
    startedAt: a.startedAt.toISOString(),
    endedAt: a.endedAt?.toISOString() ?? null,
    isActive: a.isActive,
  }));

  return {
    maid,
    leaves: leaveRows,
    pay: payRows,
    assignments: assignmentRows,
  };
});

export const getMaidPayForMonth = cache(async function getMaidPayForMonth(
  orgId: string,
  userId: string,
  ymd: string, // "YYYY-MM"
) {
  const start = new Date(`${ymd}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);

  const rows = await prisma.chairopsMaidDailyPay.findMany({
    where: { orgId, maidId: userId, date: { gte: start, lt: end } },
    orderBy: { date: "asc" },
    include: { paidBy: { select: { displayName: true } } },
  });

  return rows.map((r) => ({
    id: r.id,
    date: r.date.toISOString().slice(0, 10),
    amount: r.amount,
    note: r.note,
    paidByName: r.paidBy.displayName,
    paidAt: r.paidAt.toISOString(),
  }));
});
