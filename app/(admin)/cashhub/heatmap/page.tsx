// Heatmap V2 — 3-tab page: matrix / bank reconcile / timeline.
// Server-fetches all 3 data sources in parallel, hands off to client tabs.

import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { startOfMonth, getDate, getDaysInMonth, subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { hasCrossBranchAccess } from "@/lib/auth/branch-access";
import { can } from "@/lib/auth/permissions";
import { loadReconcile } from "@/lib/cashhub/bank-reconcile";
import { HeatmapV2View } from "@/components/cashhub/redesign/heatmap-v2";
import { bkkMonthLabel } from "@/lib/cashhub/aggregator";
import type { TimelineEntry } from "@/components/cashhub/redesign/timeline-tab";

export const dynamic = "force-dynamic";
const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

interface TimelineRow {
  id: string;
  report_date: string;
  total_sales: number;
  status: string;
  submitted_at: string | null;
  approved_at: string | null;
  submitted_by_id: string | null;
  branches:
    | { code: string; name: string }
    | { code: string; name: string }[]
    | null;
}

export default async function HeatmapPage() {
  const session = await requireSession();
  requireExecutiveRole(session.user.role);

  const admin = adminClient();
  const now = new Date();
  const today = formatInTimeZone(now, TZ, "yyyy-MM-dd");
  const monthStart = formatInTimeZone(startOfMonth(now), TZ, "yyyy-MM-dd");
  const monthYm = monthStart.slice(0, 7);
  const daysInMonth = getDaysInMonth(now);
  const daysElapsed = getDate(now);
  const reconcileFrom = formatInTimeZone(subDays(now, 2), TZ, "yyyy-MM-dd");

  const [branchesQ, reportsQ, reconcile, timelineQ] = await Promise.all([
    admin
      .from("branches")
      .select("id, code, name, business_type")
      .eq("org_id", session.user.org_id)
      .eq("is_active", true)
      .order("code"),
    admin
      .from("daily_reports")
      .select("branch_id, report_date, status")
      .eq("org_id", session.user.org_id)
      .gte("report_date", monthStart)
      .lte("report_date", today),
    loadReconcile(session.user.org_id, {
      from: reconcileFrom,
      to: today,
    }),
    admin
      .from("daily_reports")
      .select(
        "id, report_date, total_sales, status, submitted_at, approved_at, submitted_by_id, branches!inner(code, name)",
      )
      .eq("org_id", session.user.org_id)
      .gte("report_date", reconcileFrom)
      .lte("report_date", today)
      .order("submitted_at", { ascending: false, nullsFirst: false })
      .limit(40),
  ]);

  const branches = branchesQ.data ?? [];
  const reports = reportsQ.data ?? [];

  // Build matrix
  const matrix: Record<string, Record<number, string>> = {};
  for (const r of reports) {
    const day = parseInt(r.report_date.slice(8, 10), 10);
    const m = matrix[r.branch_id] ?? {};
    const cur = m[day];
    const next = r.status as string;
    if (
      !cur ||
      (cur !== "approved" && next === "approved") ||
      (cur === "rejected" && next === "submitted")
    ) {
      m[day] = next;
    }
    matrix[r.branch_id] = m;
  }

  // Hydrate timeline entries (resolve staff names from a 2nd users query —
  // Pool's existing pattern, see lib/cashhub/bank-reconcile.ts)
  const timelineRaw = (timelineQ.data ?? []) as unknown as TimelineRow[];
  const submitterIds = Array.from(
    new Set(
      timelineRaw.map((r) => r.submitted_by_id).filter((v): v is string => !!v),
    ),
  );
  const submitterMap = new Map<string, string>();
  if (submitterIds.length > 0) {
    const { data } = await admin
      .from("users")
      .select("id, name")
      .in("id", submitterIds);
    for (const u of data ?? []) submitterMap.set(u.id, u.name);
  }

  const timeline: TimelineEntry[] = timelineRaw
    .filter((r) => r.status === "approved" || r.status === "submitted" || r.status === "rejected")
    .map((r) => {
      const branch = Array.isArray(r.branches) ? r.branches[0] : r.branches;
      return {
        id: r.id,
        date: r.report_date,
        branchCode: branch?.code ?? "—",
        branchName: branch?.name ?? "—",
        amount: Number(r.total_sales || 0),
        status: r.status as "approved" | "submitted" | "rejected",
        submittedAt: r.submitted_at,
        staffName: r.submitted_by_id
          ? submitterMap.get(r.submitted_by_id) ?? null
          : null,
      };
    });

  const todayDay = getDate(now);
  const canFill = hasCrossBranchAccess(session.user.role);
  const canApprove = can(session.user, "cashhub.approve");

  return (
    <HeatmapV2View
      branches={branches}
      matrix={matrix}
      daysInMonth={daysInMonth}
      todayDay={todayDay}
      monthYm={monthYm}
      monthLabelTh={bkkMonthLabel()}
      daysElapsed={daysElapsed}
      reportsTotalMonth={reports.length}
      canFill={canFill}
      canApprove={canApprove}
      reconcile={reconcile}
      timeline={timeline}
    />
  );
}
