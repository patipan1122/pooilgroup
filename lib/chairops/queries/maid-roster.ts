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
  MaidActivityTableRow,
  MaidStatsForBranch,
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

// Average gap (in days) between consecutive events. Sorts internally — do NOT
// assume the caller's array is already ordered (the deposit "day" values fed
// in here are ocrDate ?? depositedAt, which can be out of order even when the
// underlying query was sorted by depositedAt).
// CEO 2026-08-23: "เฉลี่ยฝากเงินทุกกี่วัน" — plain average interval, not calendar buckets.
function avgGapDays(dates: Date[]): number | null {
  if (dates.length < 2) return null;
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  let totalMs = 0;
  for (let i = 1; i < sorted.length; i++) {
    totalMs += sorted[i].getTime() - sorted[i - 1].getTime();
  }
  return totalMs / (sorted.length - 1) / (1000 * 60 * 60 * 24);
}

// Groups a maid's historical collect/deposit timestamps into "times of day"
// clusters and returns the top `max` clusters (by size) as "HH:MM" strings,
// in chronological order. CEO 2026-08-23 explicitly rejected a flat average
// (collecting 08:00 + 18:00 averages to a meaningless 13:00) — this instead
// gap-clusters same-day-ish times together (splitting on the biggest gaps)
// and averages ONLY within a cluster, so "ผมมักเก็บเช้า 08:00 · เย็น 18:00" is
// what actually shows, not a midpoint nobody ever collects at.
function clusterTimesOfDay(dates: Date[], max = 2, tz = "Asia/Bangkok"): string[] {
  if (dates.length === 0) return [];
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const minutesOfDay = dates
    .map((d) => {
      const parts = fmt.formatToParts(d);
      const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
      const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
      return h * 60 + m;
    })
    .sort((a, b) => a - b);

  const GAP_MINUTES = 180; // >3h gap ⇒ new cluster (separates morning/noon/evening rounds)
  const clusters: number[][] = [[minutesOfDay[0]]];
  for (let i = 1; i < minutesOfDay.length; i++) {
    const cur = clusters[clusters.length - 1];
    if (minutesOfDay[i] - cur[cur.length - 1] <= GAP_MINUTES) cur.push(minutesOfDay[i]);
    else clusters.push([minutesOfDay[i]]);
  }

  return clusters
    .map((c) => ({ avgMin: c.reduce((s, v) => s + v, 0) / c.length, count: c.length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, max)
    .sort((a, b) => a.avgMin - b.avgMin)
    .map((c) => {
      const h = Math.floor(c.avgMin / 60);
      const m = Math.round(c.avgMin % 60);
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    });
}

export const listMaidRoster = cache(async function listMaidRoster(
  orgId: string,
): Promise<MaidRosterRow[]> {
  const today = bkkToday();
  const monthStart = firstOfMonthBkk();

  // 1. Pull every MAID + every branch in one shot (small data).
  const [maids, branches, leavesToday, payAgg, leaveMonthAgg, branchCounts, contracts] =
    await Promise.all([
    prisma.chairopsUser.findMany({
      where: { orgId, role: "MAID" },
      select: {
        id: true,
        displayName: true,
        phone: true,
        primaryBranchId: true,
        isActive: true,
        // F4b (CEO 2026-08-02) — contract-readiness columns in ?view=maid.
        bankAccountNo: true,
        contractFileUrl: true, // legacy uploaded-PDF attachment
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
    // F4b (CEO 2026-08-02): online employment contracts — for the "สัญญา / เซ็น"
    // columns. VOID contracts don't count as "having a contract".
    prisma.chairopsMaidContract.findMany({
      where: { orgId, status: { not: "VOID" } },
      select: { maidId: true, status: true },
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
  // Per-maid contract state: has any (DRAFT/SIGNED) + has a SIGNED one.
  const contractByMaid = new Map<string, { hasAny: boolean; signed: boolean }>();
  for (const c of contracts) {
    const cur = contractByMaid.get(c.maidId) ?? { hasAny: false, signed: false };
    cur.hasAny = true;
    if (c.status === "SIGNED") cur.signed = true;
    contractByMaid.set(c.maidId, cur);
  }

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
      hasBankAccount: !!m.bankAccountNo?.trim(),
      hasContract:
        (contractByMaid.get(m.id)?.hasAny ?? false) || !!m.contractFileUrl,
      contractSigned: contractByMaid.get(m.id)?.signed ?? false,
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

// Maid activity table (CEO 2026-08-23) — one row per maid×branch, replacing
// the branch-card grid on ?view=branch. Every stat column is derived from
// real collection/deposit history — no new DB fields, no manual entry.
//
// Sort order (CEO 2026-08-23 follow-up): active branches first (maid rows or
// the red "no maid" alert), then any active maid with zero active-branch
// coverage, then closed branches, then resigned maids — closed/resigned sink
// to the very bottom instead of confusingly interrupting the active list.
const ACTIVITY_WINDOW_DAYS = 180; // bounds the gap-avg + time-cluster queries to recent behavior

function compositeKey(maidId: string, branchId: string): string {
  return `${maidId}::${branchId}`;
}

export const listMaidActivityRoster = cache(async function listMaidActivityRoster(
  orgId: string,
): Promise<MaidActivityTableRow[]> {
  const windowStart = new Date(Date.now() - ACTIVITY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [
    maids,
    branches,
    assignments,
    firstDepositByMaid,
    lastCollectionByMaidBranch,
    recentDeposits,
    recentCollections,
  ] = await Promise.all([
    // no isActive filter — resigned maids still need to render (muted, at the bottom).
    prisma.chairopsUser.findMany({
      where: { orgId, role: "MAID" },
      select: { id: true, displayName: true, primaryBranchId: true, bankAccountNo: true, isActive: true },
      orderBy: { displayName: "asc" },
    }),
    // no isActive filter — closed branches still need to render (muted, at the bottom).
    prisma.chairopsBranch.findMany({
      where: { orgId },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: "asc" },
    }),
    // active coverage (assignments ∪ primaryBranchId), same convention as
    // listMaidRosterByBranch — this is what fixes the "covers 2 branches but
    // only ever shown at 1" bug CEO caught.
    prisma.chairopsMaidAssignment.findMany({
      where: { orgId, isActive: true, endedAt: null },
      select: { userId: true, branchId: true },
    }),
    // first-ever deposit anywhere = "start of work" proxy (CEO 2026-08-23 decision).
    prisma.chairopsCashDeposit.groupBy({
      by: ["maidId"],
      where: { orgId },
      _min: { depositedAt: true },
    }),
    // last collection ever, PER (maid, branch) — not window-bounded, and
    // branch-scoped now that a maid can show up at more than one branch.
    prisma.chairopsCashCollection.groupBy({
      by: ["maidId", "branchId"],
      where: { orgId, deletedAt: null },
      _max: { collectedAt: true },
    }),
    prisma.chairopsCashDeposit.findMany({
      where: { orgId, depositedAt: { gte: windowStart } },
      select: { maidId: true, branchId: true, depositedAt: true, ocrDate: true },
    }),
    prisma.chairopsCashCollection.findMany({
      where: { orgId, deletedAt: null, collectedAt: { gte: windowStart } },
      select: { maidId: true, branchId: true, collectedAt: true },
    }),
  ]);

  const branchById = new Map(branches.map((b) => [b.id, b]));
  const firstDepositByMaidMap = new Map(firstDepositByMaid.map((d) => [d.maidId, d._min.depositedAt]));
  const lastCollectionByMaidBranchMap = new Map(
    lastCollectionByMaidBranch.map((c) => [compositeKey(c.maidId, c.branchId), c._max.collectedAt]),
  );

  function pushTo(map: Map<string, Date[]>, key: string, value: Date) {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  }

  // deposit "day" values for the gap-average, PER (maid, branch) — prefer the
  // slip's own printed date over the app-recorded time when OCR read it.
  const depositDaysByMaidBranch = new Map<string, Date[]>();
  // collect + deposit times PER MAID (not branch-split) — "when does she
  // usually operate" is a personal habit, and splitting by branch would
  // starve the cluster sample for anyone covering >1 branch.
  const timeEventsByMaid = new Map<string, Date[]>();
  for (const d of recentDeposits) {
    const day = d.ocrDate ?? d.depositedAt;
    pushTo(depositDaysByMaidBranch, compositeKey(d.maidId, d.branchId), day);
    pushTo(timeEventsByMaid, d.maidId, day);
  }
  for (const c of recentCollections) {
    pushTo(timeEventsByMaid, c.maidId, c.collectedAt);
  }

  // maid → set of ACTIVE branches they cover (assignments ∪ primary),
  // excluding closed branches — a closed branch gets its own row kind
  // instead of a maid row, even if a stale assignment still points at it.
  const maidActiveBranches = new Map<string, Set<string>>();
  for (const m of maids) maidActiveBranches.set(m.id, new Set());
  for (const a of assignments) {
    if (branchById.get(a.branchId)?.isActive) maidActiveBranches.get(a.userId)?.add(a.branchId);
  }
  for (const m of maids) {
    if (m.primaryBranchId && branchById.get(m.primaryBranchId)?.isActive) {
      maidActiveBranches.get(m.id)?.add(m.primaryBranchId);
    }
  }

  const today = bkkToday();
  // one row PER BRANCH now (CEO 2026-08-23: printing the branch name once per
  // maid looked like duplicate rows) — group each maid's stats under the
  // branch(es) she covers instead of emitting a row per maid×branch pair.
  const statsByBranch = new Map<string, MaidStatsForBranch[]>();
  const resigned: MaidActivityTableRow[] = [];

  function buildStats(m: (typeof maids)[number], branchId: string | null): MaidStatsForBranch {
    const firstDeposit = firstDepositByMaidMap.get(m.id);
    return {
      userId: m.id,
      displayName: m.displayName,
      isPrimary: m.primaryBranchId === branchId,
      hasBankAccount: !!m.bankAccountNo?.trim(),
      daysWorking: firstDeposit
        ? Math.max(0, Math.floor((today.getTime() - firstDeposit.getTime()) / (24 * 60 * 60 * 1000)))
        : null,
      lastCollectedAt: branchId
        ? (lastCollectionByMaidBranchMap.get(compositeKey(m.id, branchId))?.toISOString() ?? null)
        : null,
      avgDepositGapDays: branchId ? avgGapDays(depositDaysByMaidBranch.get(compositeKey(m.id, branchId)) ?? []) : null,
      typicalTimes: clusterTimesOfDay(timeEventsByMaid.get(m.id) ?? []),
    };
  }

  function pushStats(branchId: string, stats: MaidStatsForBranch) {
    const list = statsByBranch.get(branchId) ?? [];
    list.push(stats);
    statsByBranch.set(branchId, list);
  }

  for (const m of maids) {
    if (!m.isActive) {
      resigned.push({
        kind: "resigned_maid",
        userId: m.id,
        displayName: m.displayName,
        lastBranchName: m.primaryBranchId ? (branchById.get(m.primaryBranchId)?.name ?? null) : null,
      });
      continue;
    }

    const coverage = maidActiveBranches.get(m.id) ?? new Set<string>();
    if (coverage.size === 0) {
      // active but no active-branch coverage — grouped under a pseudo
      // "ยังไม่ผูกสาขา" branch (branchId "") so nothing is silently hidden.
      pushStats("", buildStats(m, m.primaryBranchId));
      continue;
    }
    for (const branchId of coverage) {
      pushStats(branchId, buildStats(m, branchId));
    }
  }

  function sortStats(list: MaidStatsForBranch[]): MaidStatsForBranch[] {
    return [...list].sort((a, c) =>
      a.isPrimary === c.isPrimary ? a.displayName.localeCompare(c.displayName, "th") : a.isPrimary ? -1 : 1,
    );
  }

  const activeOut: MaidActivityTableRow[] = [];
  const closedOut: MaidActivityTableRow[] = [];
  for (const b of branches) {
    if (!b.isActive) {
      closedOut.push({ kind: "closed_branch", branchId: b.id, branchName: b.name });
      continue;
    }
    const maidsHere = statsByBranch.get(b.id);
    if (maidsHere?.length) {
      activeOut.push({ kind: "branch_with_maids", branchId: b.id, branchName: b.name, maids: sortStats(maidsHere) });
    } else {
      activeOut.push({ kind: "no_maid", branchId: b.id, branchName: b.name });
    }
  }

  const unassignedStats = statsByBranch.get("");
  const unassignedOut: MaidActivityTableRow[] = unassignedStats?.length
    ? [{ kind: "branch_with_maids", branchId: "", branchName: "ยังไม่ผูกสาขา", maids: sortStats(unassignedStats) }]
    : [];

  return [...activeOut, ...unassignedOut, ...closedOut, ...resigned];
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
        // F4b (CEO 2026-08-02) — office contract editor prefill + nickname.
        nickname: true,
        mobilePhone: true,
        idCardNumber: true,
        idCardImageUrl: true,
        idCardFileName: true,
        homeAddress: true,
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
