// Full calendar heatmap (per branch × per day) — quick visual fill audit
// feedback_popup_first_drilldown.md — กดเซลล์ = popup
// feedback_filter_pattern_biztype_first.md — แถวสาขา grouped

import { CalendarDays } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { requireExecutiveRole } from "@/lib/auth/role-guards";
import { adminClient } from "@/lib/db/server";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Section } from "@/components/ui/section";
import { Badge } from "@/components/ui/badge";
import { startOfMonth, getDate, getDaysInMonth } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { BackButton } from "@/components/ui/back-button";
import { hasCrossBranchAccess } from "@/lib/auth/branch-access";
import { can } from "@/lib/auth/permissions";
import { HeatmapGrid } from "./heatmap-grid";

export const dynamic = "force-dynamic";
const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

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

  const [branchesQ, reportsQ] = await Promise.all([
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
  ]);

  const branches = branchesQ.data ?? [];
  const reports = reportsQ.data ?? [];

  // Build matrix (plain object — passes server→client cleanly)
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

  const todayDay = getDate(now);
  const canFill = hasCrossBranchAccess(session.user.role);
  const canApprove = can(session.user, "cashhub.approve");

  return (
    <div className="p-3 sm:p-6 lg:p-10 max-w-7xl mx-auto pb-24">
      <BackButton label="ภาพรวม" fallbackHref="/cashhub/dashboard" />
      <header className="mt-3 mb-6">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-600)] font-bold flex items-center gap-2">
          <CalendarDays className="size-4" /> HEATMAP
        </p>
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-[-0.04em] font-display mt-4 leading-[1]">
          ปฏิทิน <span className="text-gradient-blue">สาขา × วัน</span>
        </h1>
        <p className="text-zinc-600 mt-1 text-sm">
          กดเซลล์เพื่อดูรายงาน · กดที่ชื่อสาขาเพื่อดูประวัติเต็ม
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-500 mb-3">
        <Badge tone="success">✅ อนุมัติ</Badge>
        <Badge tone="warning">⏳ รออนุมัติ</Badge>
        <Badge tone="danger">🔴 ปฏิเสธ / ❌ ไม่กรอก</Badge>
        <span className="text-[11px]">
          เดือนนี้ {daysElapsed}/{daysInMonth} วัน · {reports.length} รายงาน
        </span>
      </div>

      <Section
        number="01"
        label="MATRIX"
        title={`${branches.length} สาขา × ${daysInMonth} วัน`}
      >
        <Card>
          <CardHeader>
            <CardTitle>ตารางกรอกครบ</CardTitle>
            <Badge tone="brand">{reports.length} รายงาน</Badge>
          </CardHeader>
          <CardBody>
            <HeatmapGrid
              branches={branches}
              matrix={matrix}
              daysInMonth={daysInMonth}
              todayDay={todayDay}
              monthYm={monthYm}
              canFill={canFill}
              canApprove={canApprove}
            />
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}
