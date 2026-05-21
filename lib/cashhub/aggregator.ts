// One stop server-side aggregator for the Executive Dashboard.
// Pulls every chunk in parallel, returns a single typed payload.
// All queries scoped by org_id. Tables that may not exist yet (targets/health/streak)
// fall back to empty results — UI degrades gracefully.

import { adminClient } from "@/lib/db/server";
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  subDays,
  getDaysInMonth,
  getDate,
  format,
} from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { forecast, targetProgress } from "./forecast";
import { loadBranches, loadReports } from "./data";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

export type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;

export interface BranchRow {
  id: string;
  code: string;
  name: string;
  business_type: string;
  is_active: boolean;
  manager_id: string | null;
  province: string | null;
  region: string | null;
}

interface ReportRow {
  id: string;
  branch_id: string;
  report_date: string;
  shift: string;
  status: string;
  total_sales: number;
  cash: number;
  transfer: number;
  card: number;
  credit: number;
  shortage: number;
  qty1: number | null;
  notes: string | null;
  submitted_at: string | null;
  approved_at: string | null;
}

export async function loadDashboard(orgId: string, companyId?: string) {
  const admin = adminClient();
  const now = new Date();
  const today = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const monthStart = formatInTimeZone(startOfMonth(now), TZ, "yyyy-MM-dd");
  const prevMonthStart = formatInTimeZone(
    startOfMonth(subMonths(now, 1)),
    TZ,
    "yyyy-MM-dd",
  );
  const prevMonthEnd = formatInTimeZone(
    endOfMonth(subMonths(now, 1)),
    TZ,
    "yyyy-MM-dd",
  );
  const last30 = formatInTimeZone(subDays(now, 29), TZ, "yyyy-MM-dd");
  const daysInMonth = getDaysInMonth(now);
  const daysElapsed = getDate(now);
  const monthYear = parseInt(formatInTimeZone(now, TZ, "yyyy"), 10);
  const monthNum = parseInt(formatInTimeZone(now, TZ, "M"), 10);

  // ---- Parallel fetch ----
  // Phase A: kick off `loadBranches` together with every query that only
  // filters by org_id (i.e. doesn't need branchIds). Saves 80-150ms vs the
  // previous sequential `await loadBranches` → `Promise.all` pattern.
  const [
    branches,
    pendingQ,
    targetsQ,
    healthQ,
    streaksQ,
    shortagesMtdQ,
    missingReasonsQ,
  ] = await Promise.all([
    loadBranches(orgId, { companyId }),
    admin
      .from("daily_reports")
      .select(
        "id, branch_id, report_date, shift, total_sales, cash, transfer, card, credit, shortage, submitted_at, branches(code, name, business_type)",
      )
      .eq("org_id", orgId)
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false })
      .limit(20),
    safeFrom(admin, "branch_targets")
      .select("branch_id, year, month, amount")
      .eq("org_id", orgId)
      .eq("year", monthYear)
      .eq("month", monthNum),
    safeFrom(admin, "branch_health_scores")
      .select("branch_id, score, grade, computed_for, breakdown")
      .eq("org_id", orgId)
      .order("computed_for", { ascending: false }),
    safeFrom(admin, "branch_streaks")
      .select("branch_id, current_streak, longest_streak, last_report_date")
      .eq("org_id", orgId),
    admin
      .from("cash_shortages")
      .select("id, branch_id, report_date, amount, person_name, is_identified")
      .eq("org_id", orgId)
      .gte("report_date", monthStart)
      .lte("report_date", today),
    safeFrom(admin, "missing_report_reasons")
      .select("branch_id, report_date, reason_type, reason_text")
      .eq("org_id", orgId)
      .gte("report_date", subDays(now, 14).toISOString().slice(0, 10))
      .lte("report_date", today),
  ]);

  const branchIds = branches.map((b) => b.id);
  // When companyId is set, restrict report queries to those branches
  const reportBranchFilter = companyId ? branchIds : undefined;

  // Phase B: report queries depend on branchIds when scoping by company.
  const [monthReports, prevMonthReports, last30Reports] = await Promise.all([
    loadReports(orgId, {
      dateFrom: monthStart,
      dateTo: today,
      statuses: [],
      branchIds: reportBranchFilter,
    }),
    loadReports(orgId, {
      dateFrom: prevMonthStart,
      dateTo: prevMonthEnd,
      statuses: [],
      branchIds: reportBranchFilter,
    }),
    loadReports(orgId, {
      dateFrom: last30,
      dateTo: today,
      statuses: [],
      branchIds: reportBranchFilter,
    }),
  ]);

  const pending = pendingQ.data ?? [];
  const targets = (targetsQ.data ?? []) as Array<{
    branch_id: string;
    year: number;
    month: number;
    amount: number | string;
  }>;
  const health = (healthQ.data ?? []) as Array<{
    branch_id: string;
    score: number;
    grade: string;
    computed_for: string;
    breakdown: Record<string, unknown>;
  }>;
  const streaks = (streaksQ.data ?? []) as Array<{
    branch_id: string;
    current_streak: number;
    longest_streak: number;
    last_report_date: string | null;
  }>;
  const shortagesMtd = (shortagesMtdQ.data ?? []) as Array<{
    id: string;
    branch_id: string;
    amount: number | string;
    person_name: string | null;
    is_identified: boolean;
    report_date: string;
  }>;
  const missingReasons = (missingReasonsQ.data ?? []) as Array<{
    branch_id: string;
    report_date: string;
    reason_type: string;
    reason_text: string | null;
  }>;

  // ---- Latest health row per branch (already ordered desc) ----
  const healthByBranch = new Map<string, (typeof health)[number]>();
  for (const h of health) {
    if (!healthByBranch.has(h.branch_id)) healthByBranch.set(h.branch_id, h);
  }

  const streakByBranch = new Map(streaks.map((s) => [s.branch_id, s]));
  const targetByBranch = new Map(
    targets.map((t) => [t.branch_id, Number(t.amount)]),
  );

  // ---- Money this month (approved vs pending) ----
  const monthApproved = monthReports
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + Number(r.total_sales || 0), 0);
  const monthPending = monthReports
    .filter((r) => r.status === "submitted")
    .reduce((s, r) => s + Number(r.total_sales || 0), 0);
  const monthRejected = monthReports
    .filter((r) => r.status === "rejected")
    .reduce((s, r) => s + Number(r.total_sales || 0), 0);

  // Payment channel mix (approved only)
  const mix = monthReports
    .filter((r) => r.status === "approved")
    .reduce(
      (acc, r) => {
        acc.cash += Number(r.cash || 0);
        acc.transfer += Number(r.transfer || 0);
        acc.card += Number(r.card || 0);
        acc.credit += Number(r.credit || 0);
        acc.shortage += Number(r.shortage || 0);
        return acc;
      },
      { cash: 0, transfer: 0, card: 0, credit: 0, shortage: 0 },
    );

  const prevMonthTotal = prevMonthReports
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + Number(r.total_sales || 0), 0);

  // Forecast & target overall
  const overallForecast = forecast({
    actualMtd: monthApproved + monthPending,
    daysElapsed,
    daysInMonth,
    prevMonthTotal,
  });
  const overallTarget = Array.from(targetByBranch.values()).reduce(
    (s, n) => s + n,
    0,
  );
  const overallProgress = targetProgress({
    target: overallTarget,
    actual: monthApproved,
    daysElapsed,
    daysInMonth,
  });

  // Today's reports indexed
  const todayByBranch = new Map<string, ReportRow[]>();
  for (const r of monthReports) {
    if (r.report_date === today) {
      const list = todayByBranch.get(r.branch_id) ?? [];
      list.push(r);
      todayByBranch.set(r.branch_id, list);
    }
  }

  // 7-day sparkline per branch (approved + submitted, by date)
  const last7Start = formatInTimeZone(subDays(now, 6), TZ, "yyyy-MM-dd");
  const sparkByBranch = new Map<string, Array<{ date: string; value: number }>>();
  // build date list
  const days7: string[] = [];
  for (let i = 6; i >= 0; i--) {
    days7.push(formatInTimeZone(subDays(now, i), TZ, "yyyy-MM-dd"));
  }
  for (const r of last30Reports) {
    if (r.report_date < last7Start) continue;
    const arr = sparkByBranch.get(r.branch_id) ?? days7.map((d) => ({ date: d, value: 0 }));
    const slot = arr.find((s) => s.date === r.report_date);
    if (slot) slot.value += Number(r.total_sales || 0);
    sparkByBranch.set(r.branch_id, arr);
  }

  // ---- By business type ----
  type TypeBucket = {
    type: string;
    branches: BranchRow[];
    total: number;
    targetTotal: number;
    submittedToday: number;
    pendingToday: number;
    missingToday: number;
    branchCount: number;
  };
  const byTypeMap = new Map<string, TypeBucket>();
  for (const b of branches) {
    const bucket =
      byTypeMap.get(b.business_type) ??
      ({
        type: b.business_type,
        branches: [] as BranchRow[],
        total: 0,
        targetTotal: 0,
        submittedToday: 0,
        pendingToday: 0,
        missingToday: 0,
        branchCount: 0,
      } as TypeBucket);
    bucket.branches.push(b);
    bucket.branchCount += 1;
    bucket.targetTotal += targetByBranch.get(b.id) ?? 0;

    const todayForBranch = todayByBranch.get(b.id) ?? [];
    if (todayForBranch.length === 0) {
      bucket.missingToday += 1;
    } else if (todayForBranch.every((r) => r.status === "approved")) {
      bucket.submittedToday += 1;
    } else if (todayForBranch.some((r) => r.status === "submitted")) {
      bucket.pendingToday += 1;
    } else {
      bucket.submittedToday += 1; // rejected counts as "they tried" — show under submitted
    }
    byTypeMap.set(b.business_type, bucket);
  }
  // Index branches by id for O(1) lookup (was O(N) find inside loop → O(N*M))
  const branchByIdMap = new Map(branches.map((b) => [b.id, b]));
  for (const r of monthReports) {
    if (r.status === "approved") {
      const branch = branchByIdMap.get(r.branch_id);
      if (branch) {
        const bucket = byTypeMap.get(branch.business_type);
        if (bucket) bucket.total += Number(r.total_sales || 0);
      }
    }
  }

  // ---- Per-branch summary ----
  type BranchSummary = {
    branch: BranchRow;
    monthTotal: number;
    target: number;
    progressPct: number;
    todayStatus: "approved" | "submitted" | "missing" | "rejected" | "partial";
    spark: Array<{ date: string; value: number }>;
    health: { score: number; grade: string } | null;
    streak: {
      current: number;
      longest: number;
      lastDate: string | null;
    } | null;
    daysSinceLastReport: number | null;
  };
  // Pre-bucket monthReports by branch_id once — was O(branches × reports)
  // per branch summary (40 × 1200 = 48k iterations on a healthy org).
  const monthByBranch = new Map<string, typeof monthReports>();
  for (const r of monthReports) {
    const list = monthByBranch.get(r.branch_id) ?? [];
    list.push(r);
    monthByBranch.set(r.branch_id, list);
  }

  const branchSummaries: BranchSummary[] = branches.map((b) => {
    const monthTotal = (monthByBranch.get(b.id) ?? [])
      .filter((r) => r.status === "approved")
      .reduce((s, r) => s + Number(r.total_sales || 0), 0);
    const target = targetByBranch.get(b.id) ?? 0;
    const progressPct = target > 0 ? (monthTotal / target) * 100 : 0;
    const todayList = todayByBranch.get(b.id) ?? [];
    let todayStatus: BranchSummary["todayStatus"] = "missing";
    if (todayList.length > 0) {
      const all = todayList.map((r) => r.status);
      if (all.every((s) => s === "approved")) todayStatus = "approved";
      else if (all.some((s) => s === "submitted")) todayStatus = "submitted";
      else if (all.every((s) => s === "rejected")) todayStatus = "rejected";
      else todayStatus = "partial";
    }
    const h = healthByBranch.get(b.id);
    const s = streakByBranch.get(b.id);
    const lastDate = s?.last_report_date ?? null;
    const daysSinceLastReport = lastDate
      ? Math.max(
          0,
          Math.round(
            (new Date(today).getTime() - new Date(lastDate).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : null;

    const spark = sparkByBranch.get(b.id) ?? days7.map((d) => ({ date: d, value: 0 }));

    return {
      branch: b,
      monthTotal,
      target,
      progressPct,
      todayStatus,
      spark,
      health: h ? { score: h.score, grade: h.grade } : null,
      streak: s
        ? {
            current: s.current_streak,
            longest: s.longest_streak,
            lastDate: s.last_report_date,
          }
        : null,
      daysSinceLastReport,
    };
  });

  // ---- Daily totals (calendar heatmap) ----
  const dailyTotals: Array<{
    date: string;
    total: number;
    expected: number;
    submitted: number;
    fillRate: number;
  }> = [];
  const expectedBranches = branches.length;
  const datesSet = new Set<string>();
  for (let i = 0; i < daysElapsed; i++) {
    datesSet.add(
      formatInTimeZone(subDays(now, daysElapsed - 1 - i), TZ, "yyyy-MM-dd"),
    );
  }
  const datesArr = Array.from(datesSet).sort();
  for (const d of datesArr) {
    const todayReports = monthReports.filter((r) => r.report_date === d);
    const branchesReported = new Set(todayReports.map((r) => r.branch_id));
    const total = todayReports
      .filter((r) => r.status === "approved")
      .reduce((s, r) => s + Number(r.total_sales || 0), 0);
    dailyTotals.push({
      date: d,
      total,
      expected: expectedBranches,
      submitted: branchesReported.size,
      fillRate:
        expectedBranches > 0 ? (branchesReported.size / expectedBranches) * 100 : 0,
    });
  }

  // ---- Critical alerts ("ต้องดูแลวันนี้") ----
  const alerts: Array<{
    kind: "missing" | "spike" | "low" | "credit_high" | "shortage";
    branch?: BranchRow;
    message: string;
    severity: "warning" | "danger" | "info";
  }> = [];
  for (const summary of branchSummaries) {
    if (summary.daysSinceLastReport !== null && summary.daysSinceLastReport >= 2) {
      alerts.push({
        kind: "missing",
        branch: summary.branch,
        severity: summary.daysSinceLastReport >= 4 ? "danger" : "warning",
        message: `${summary.branch.code} ขาด ${summary.daysSinceLastReport} วัน`,
      });
    }
  }
  // Credit ratio anomaly (overall)
  const totalReceived =
    mix.cash + mix.transfer + mix.card + mix.credit + mix.shortage;
  if (totalReceived > 0) {
    const creditPct = (mix.credit / totalReceived) * 100;
    if (creditPct >= 10) {
      alerts.push({
        kind: "credit_high",
        severity: "warning",
        message: `เครดิตค้าง ${creditPct.toFixed(1)}% ของยอดรับเดือนนี้ (สูงกว่าปกติ)`,
      });
    }
  }
  if (mix.shortage > 0) {
    alerts.push({
      kind: "shortage",
      severity: "warning",
      message: `เงินขาดเดือนนี้ ฿${Number(mix.shortage).toLocaleString("th-TH", { maximumFractionDigits: 0 })}`,
    });
  }

  // ---- Pattern heatmap (day-of-week × business-type) for last 30 days ----
  type CellAcc = { sum: number; count: number };
  const patternAcc: Record<string, Record<number, CellAcc>> = {}; // type -> dow(0-6) -> sum
  const branchTypeMap = new Map(branches.map((b) => [b.id, b.business_type]));
  for (const r of last30Reports) {
    if (r.status !== "approved") continue;
    const t = branchTypeMap.get(r.branch_id);
    if (!t) continue;
    const dow = new Date(r.report_date + "T00:00:00").getDay();
    if (!patternAcc[t]) patternAcc[t] = {};
    const cell = patternAcc[t]![dow] ?? { sum: 0, count: 0 };
    cell.sum += Number(r.total_sales || 0);
    cell.count += 1;
    patternAcc[t]![dow] = cell;
  }
  const patternHeat: Record<string, number[]> = {}; // type -> dow average (Mon..Sun = 1..0)
  // We want Mon..Sun ordering — JS getDay = Sun(0) .. Sat(6). Map: indices [1,2,3,4,5,6,0]
  const dowOrder = [1, 2, 3, 4, 5, 6, 0];
  for (const t of Object.keys(patternAcc)) {
    patternHeat[t] = dowOrder.map((dow) => {
      const cell = patternAcc[t]![dow];
      return cell && cell.count ? cell.sum / cell.count : 0;
    });
  }

  // ---- Per-branch pattern (for drill-down): branch_id -> dow averages ----
  const branchPatternAcc: Record<string, Record<number, CellAcc>> = {};
  for (const r of last30Reports) {
    if (r.status !== "approved") continue;
    const dow = new Date(r.report_date + "T00:00:00").getDay();
    if (!branchPatternAcc[r.branch_id]) branchPatternAcc[r.branch_id] = {};
    const cell = branchPatternAcc[r.branch_id]![dow] ?? { sum: 0, count: 0 };
    cell.sum += Number(r.total_sales || 0);
    cell.count += 1;
    branchPatternAcc[r.branch_id]![dow] = cell;
  }
  const patternByBranch: Record<
    string,
    Array<{ branch_id: string; branch_code: string; branch_name: string; dows: number[] }>
  > = {};
  for (const b of branches) {
    const acc = branchPatternAcc[b.id];
    if (!acc) continue;
    const dows = dowOrder.map((d) => {
      const cell = acc[d];
      return cell && cell.count ? cell.sum / cell.count : 0;
    });
    if (dows.every((v) => v === 0)) continue;
    if (!patternByBranch[b.business_type]) patternByBranch[b.business_type] = [];
    patternByBranch[b.business_type]!.push({
      branch_id: b.id,
      branch_code: b.code,
      branch_name: b.name,
      dows,
    });
  }
  // sort branches by total avg desc
  for (const t of Object.keys(patternByBranch)) {
    patternByBranch[t]!.sort(
      (a, b) =>
        b.dows.reduce((s, v) => s + v, 0) - a.dows.reduce((s, v) => s + v, 0),
    );
  }

  return {
    today,
    monthStart,
    daysElapsed,
    daysInMonth,
    branches,
    branchSummaries,
    monthApproved,
    monthPending,
    monthRejected,
    monthTotal: monthApproved + monthPending,
    prevMonthTotal,
    forecast: overallForecast,
    targetTotal: overallTarget,
    targetProgress: overallProgress,
    pendingCount: monthReports.filter((r) => r.status === "submitted").length,
    paymentMix: mix,
    paymentMixTotal:
      mix.cash + mix.transfer + mix.card + mix.credit + mix.shortage,
    byType: Array.from(byTypeMap.values()),
    pending,
    dailyTotals,
    alerts,
    shortagesMtd,
    missingReasons,
    patternHeat,
    patternByBranch,
    last7Days: days7,
  };
}

// Wrap the supabase chain so addon tables that don't exist yet don't blow up the page.
function safeFrom(admin: ReturnType<typeof adminClient>, table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = admin.from(table);
  // Wrap the awaitable so 42P01 ("undefined_table") fails soft to {data: []}
  const orig = builder.then?.bind(builder);
  if (orig) {
    builder.then = (resolve: (v: unknown) => unknown, reject?: (r: unknown) => unknown) =>
      orig(
        (res: { data: unknown; error: { code?: string } | null }) => {
          if (res.error && (res.error.code === "42P01" || res.error.code === "PGRST205")) {
            return resolve({ data: [], error: null });
          }
          return resolve(res);
        },
        reject,
      );
  }
  return builder;
}

export const NEEDS_ATTENTION_TYPES = ["missing", "spike", "credit_high", "shortage"] as const;

// Format BKK month label for header
export function bkkMonthLabel(): string {
  const months = [
    "มกราคม",
    "กุมภาพันธ์",
    "มีนาคม",
    "เมษายน",
    "พฤษภาคม",
    "มิถุนายน",
    "กรกฎาคม",
    "สิงหาคม",
    "กันยายน",
    "ตุลาคม",
    "พฤศจิกายน",
    "ธันวาคม",
  ];
  const now = new Date();
  const m = parseInt(formatInTimeZone(now, TZ, "M"), 10) - 1;
  const yy = (parseInt(formatInTimeZone(now, TZ, "yyyy"), 10) + 543) % 100;
  return `${months[m]} ${String(yy).padStart(2, "0")}`;
}

// Re-export for convenience
export { format };

// ─────────────────────────────────────────────────────────────────────────────
// Targeted drill loader — used by /cashhub/dashboard/business/[type]
// Was: page called full loadDashboard() (9 queries + heavy aggregation) and
// then filtered to one business type in JS. Now: scope every query to the
// branches in `type` from the start. Saves ~400-800ms per drill click.
// ─────────────────────────────────────────────────────────────────────────────
export interface BusinessTypeDrillSummary {
  branch: BranchRow;
  monthTotal: number;
  target: number;
  progressPct: number;
  todayStatus: "approved" | "submitted" | "missing" | "rejected" | "partial";
  spark: Array<{ date: string; value: number }>;
  health: { score: number; grade: string } | null;
  streak: {
    current: number;
    longest: number;
    lastDate: string | null;
  } | null;
}

export interface BusinessTypeDrillData {
  today: string;
  branchSummaries: BusinessTypeDrillSummary[];
}

export async function loadBusinessTypeDrill(
  orgId: string,
  businessType: string,
): Promise<BusinessTypeDrillData> {
  const admin = adminClient();
  const now = new Date();
  const today = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const monthStart = formatInTimeZone(startOfMonth(now), TZ, "yyyy-MM-dd");
  const last7Start = formatInTimeZone(subDays(now, 6), TZ, "yyyy-MM-dd");
  const monthYear = parseInt(formatInTimeZone(now, TZ, "yyyy"), 10);
  const monthNum = parseInt(formatInTimeZone(now, TZ, "M"), 10);
  // Range that covers both monthTotal and last-7 sparkline windows.
  const rangeStart = monthStart < last7Start ? monthStart : last7Start;

  // Step 1 — branches in this type (cheap; small set)
  const { data: branchesRaw } = await admin
    .from("branches")
    .select("id, code, name, business_type, is_active, manager_id, province, region")
    .eq("org_id", orgId)
    .eq("business_type", businessType)
    .eq("is_active", true)
    .order("code", { ascending: true });
  const branches = (branchesRaw ?? []) as BranchRow[];
  if (branches.length === 0) {
    return { today, branchSummaries: [] };
  }
  const branchIds = branches.map((b) => b.id);

  // Step 2 — fan-out 4 targeted queries (scoped by branchIds → typically 70-80%
  // fewer rows than the org-wide loadDashboard equivalent).
  const [reportsQ, targetsQ, healthQ, streaksQ] = await Promise.all([
    admin
      .from("daily_reports")
      .select("branch_id, report_date, status, total_sales")
      .in("branch_id", branchIds)
      .gte("report_date", rangeStart)
      .lte("report_date", today),
    safeFrom(admin, "branch_targets")
      .select("branch_id, amount")
      .in("branch_id", branchIds)
      .eq("year", monthYear)
      .eq("month", monthNum),
    safeFrom(admin, "branch_health_scores")
      .select("branch_id, score, grade, computed_for")
      .in("branch_id", branchIds)
      .order("computed_for", { ascending: false }),
    safeFrom(admin, "branch_streaks")
      .select("branch_id, current_streak, longest_streak, last_report_date")
      .in("branch_id", branchIds),
  ]);

  type Report = {
    branch_id: string;
    report_date: string;
    status: string;
    total_sales: number | string | null;
  };
  const reports = (reportsQ.data ?? []) as Report[];
  const targetByBranch = new Map<string, number>();
  for (const t of (targetsQ.data ?? []) as Array<{
    branch_id: string;
    amount: number | string;
  }>) {
    targetByBranch.set(t.branch_id, Number(t.amount));
  }
  const healthByBranch = new Map<string, { score: number; grade: string }>();
  for (const h of (healthQ.data ?? []) as Array<{
    branch_id: string;
    score: number;
    grade: string;
    computed_for: string;
  }>) {
    // Order is desc on computed_for so the first hit per branch is latest.
    if (!healthByBranch.has(h.branch_id)) {
      healthByBranch.set(h.branch_id, { score: h.score, grade: h.grade });
    }
  }
  const streakByBranch = new Map<
    string,
    { current_streak: number; longest_streak: number; last_report_date: string | null }
  >();
  for (const s of (streaksQ.data ?? []) as Array<{
    branch_id: string;
    current_streak: number;
    longest_streak: number;
    last_report_date: string | null;
  }>) {
    streakByBranch.set(s.branch_id, s);
  }

  // Bucket reports by branch_id for O(1) per-branch slicing.
  const reportsByBranch = new Map<string, Report[]>();
  for (const r of reports) {
    const list = reportsByBranch.get(r.branch_id) ?? [];
    list.push(r);
    reportsByBranch.set(r.branch_id, list);
  }

  // Last-7-day date list (oldest → newest) for sparkline zero-fill.
  const last7Days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    last7Days.push(formatInTimeZone(subDays(now, i), TZ, "yyyy-MM-dd"));
  }

  const branchSummaries: BusinessTypeDrillSummary[] = branches.map((b) => {
    const list = reportsByBranch.get(b.id) ?? [];

    const monthTotal = list
      .filter((r) => r.report_date >= monthStart && r.status === "approved")
      .reduce((s, r) => s + Number(r.total_sales || 0), 0);

    const target = targetByBranch.get(b.id) ?? 0;
    const progressPct = target > 0 ? (monthTotal / target) * 100 : 0;

    const todayList = list.filter((r) => r.report_date === today);
    let todayStatus: BusinessTypeDrillSummary["todayStatus"] = "missing";
    if (todayList.length > 0) {
      const statuses = todayList.map((r) => r.status);
      if (statuses.every((s) => s === "approved")) todayStatus = "approved";
      else if (statuses.some((s) => s === "submitted")) todayStatus = "submitted";
      else if (statuses.every((s) => s === "rejected")) todayStatus = "rejected";
      else todayStatus = "partial";
    }

    // Sparkline: sum per-day across shifts.
    const sparkByDate = new Map<string, number>();
    for (const r of list) {
      if (r.report_date < last7Start) continue;
      if (r.status === "rejected") continue;
      sparkByDate.set(
        r.report_date,
        (sparkByDate.get(r.report_date) ?? 0) + Number(r.total_sales || 0),
      );
    }
    const spark = last7Days.map((d) => ({
      date: d,
      value: sparkByDate.get(d) ?? 0,
    }));

    const h = healthByBranch.get(b.id);
    const s = streakByBranch.get(b.id);

    return {
      branch: b,
      monthTotal,
      target,
      progressPct,
      todayStatus,
      spark,
      health: h ?? null,
      streak: s
        ? {
            current: s.current_streak,
            longest: s.longest_streak,
            lastDate: s.last_report_date,
          }
        : null,
    };
  });

  return { today, branchSummaries };
}
