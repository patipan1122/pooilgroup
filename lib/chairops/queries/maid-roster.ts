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
} from "@/app/(admin)/chairops/(office)/maids/types";

function bkkToday(): Date {
  const tz = process.env.APP_TIMEZONE || "Asia/Bangkok";
  const ymd = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  return new Date(`${ymd}T00:00:00Z`);
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
