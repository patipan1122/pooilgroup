// /cashhub/my-branches — Branch-manager landing page
// feedback_role_scoped_views.md — ผู้จัดการสาขาเห็นแค่สาขาในความดูแล
// feedback_popup_first_drilldown.md — กดเซลล์ heatmap = popup
// feedback_filter_pattern_biztype_first.md — แถวจัดกลุ่มตามประเภทธุรกิจ

import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { loadManageableBranches } from "@/lib/auth/branch-access";
import { can } from "@/lib/auth/permissions";
import { EmptyState } from "@/components/ui/empty-state";
import { thaiDateLong, bkkToday } from "@/lib/utils/format";
import { MyBranchesView } from "./my-branches-view";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

export const dynamic = "force-dynamic";

const DAYS_BACK = 30;

export default async function MyBranchesPage() {
  const session = await requireSession();

  // Cross-branch roles ไม่จำเป็นต้องใช้หน้านี้ → ส่งไป exec dashboard
  if (
    session.user.role === "super_admin" ||
    session.user.role === "org_admin" ||
    session.user.role === "admin" ||
    session.user.role === "area_manager"
  ) {
    redirect("/cashhub/dashboard");
  }

  const admin = adminClient();
  const now = new Date();
  const today = bkkToday();
  // TZ-safe date math — anchor to Bangkok time (was: new Date(today).setDate(...)
  // which parses today as UTC midnight then loses 7h)
  const dateFrom = formatInTimeZone(
    subDays(now, DAYS_BACK - 1),
    TZ,
    "yyyy-MM-dd",
  );

  const branches = await loadManageableBranches(session.user);
  const branchIds = branches.map((b) => b.id);

  let reports: Array<{
    branch_id: string;
    report_date: string;
    status: string;
  }> = [];
  if (branchIds.length > 0) {
    const { data } = await admin
      .from("daily_reports")
      .select("branch_id, report_date, status")
      .eq("org_id", session.user.org_id)
      .in("branch_id", branchIds)
      .gte("report_date", dateFrom)
      .lte("report_date", today)
      .order("report_date", { ascending: false });
    reports = (data ?? []) as typeof reports;
  }

  // Build matrix (plain object)
  const matrix: Record<string, Record<string, string>> = {};
  for (const r of reports) {
    const m = matrix[r.branch_id] ?? {};
    const cur = m[r.report_date];
    if (
      !cur ||
      (cur !== "approved" && r.status === "approved") ||
      (cur === "rejected" && r.status === "submitted")
    ) {
      m[r.report_date] = r.status;
    }
    matrix[r.branch_id] = m;
  }

  // Day list newest → oldest, TZ-safe
  const days: string[] = Array.from({ length: DAYS_BACK }, (_, i) =>
    formatInTimeZone(subDays(now, i), TZ, "yyyy-MM-dd"),
  );

  return (
    <div className="p-4 sm:p-8 lg:p-10 max-w-6xl mx-auto pb-24">
      <header className="mb-10 animate-slide-up-soft">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--color-brand-700)] font-bold">
          CASHHUB · MY BRANCHES
          <span className="text-zinc-400 mx-2">·</span>
          <span className="text-zinc-500">{thaiDateLong(new Date())}</span>
        </p>
        <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-[-0.04em] font-display mt-4 leading-[1]">
          สาขา <span className="text-gradient-blue">ของฉัน</span>
        </h1>
        <p className="text-sm sm:text-base text-zinc-600 mt-3 max-w-2xl">
          {session.user.name} · ผู้จัดการสาขา ·{" "}
          <strong className="text-zinc-900 tabular-num">
            {branches.length}
          </strong>{" "}
          สาขาในความดูแล
        </p>
      </header>

      {branches.length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-6" />}
          title="ยังไม่มีสาขาที่ดูแล"
          description="กรุณาติดต่อ Admin ให้กำหนดสาขาให้คุณ"
        />
      ) : (
        <MyBranchesView
          branches={branches.map((b) => ({
            id: b.id,
            code: b.code,
            name: b.name,
            business_type: b.business_type,
          }))}
          matrix={matrix}
          days={days}
          today={today}
          canApprove={can(session.user, "cashhub.approve")}
        />
      )}
    </div>
  );
}
