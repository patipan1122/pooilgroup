import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { DashboardView } from "./dashboard-view";
import { startOfMonth } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await requireSession();
  const orgId = session.user.org_id;

  const today = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
  const monthStart = formatInTimeZone(startOfMonth(new Date()), TZ, "yyyy-MM-dd");

  const admin = adminClient();

  const [branchesQ, reportsQ, todayReportsQ, pendingQ] = await Promise.all([
    admin
      .from("branches")
      .select("id, code, name, business_type")
      .eq("org_id", orgId)
      .eq("is_active", true)
      .order("code"),
    admin
      .from("daily_reports")
      .select(
        "id, branch_id, total_sales, status, report_date, shift, branches(business_type)",
      )
      .eq("org_id", orgId)
      .gte("report_date", monthStart)
      .lte("report_date", today),
    admin
      .from("daily_reports")
      .select("id, branch_id, status, total_sales")
      .eq("org_id", orgId)
      .eq("report_date", today),
    admin
      .from("daily_reports")
      .select("id, branch_id, total_sales, shift, branches(name, code, business_type)")
      .eq("org_id", orgId)
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false })
      .limit(10),
  ]);

  const branches = branchesQ.data ?? [];
  const reports = reportsQ.data ?? [];
  const todayReports = todayReportsQ.data ?? [];
  const pending = pendingQ.data ?? [];

  // Aggregations
  const monthTotal = reports
    .filter((r) => r.status === "approved")
    .reduce((sum, r) => sum + Number(r.total_sales || 0), 0);

  const monthPending = reports
    .filter((r) => r.status === "submitted")
    .reduce((sum, r) => sum + Number(r.total_sales || 0), 0);

  // Group by business type
  const byType: Record<
    string,
    { total: number; branchCount: number; submittedToday: number; missingToday: number }
  > = {};

  for (const b of branches) {
    if (!byType[b.business_type]) {
      byType[b.business_type] = {
        total: 0,
        branchCount: 0,
        submittedToday: 0,
        missingToday: 0,
      };
    }
    byType[b.business_type]!.branchCount += 1;
    const todayReport = todayReports.find((r) => r.branch_id === b.id);
    if (todayReport && todayReport.status !== "rejected") {
      byType[b.business_type]!.submittedToday += 1;
    } else {
      byType[b.business_type]!.missingToday += 1;
    }
  }

  for (const r of reports) {
    if (r.status === "approved" && r.branches) {
      // Supabase returns relation as array even for single FK
      const branchRel = Array.isArray(r.branches) ? r.branches[0] : r.branches;
      const bt = (branchRel as { business_type?: string } | null)?.business_type;
      if (bt && byType[bt]) byType[bt].total += Number(r.total_sales || 0);
    }
  }

  // Total reports all time (used for onboarding empty state)
  const { count: totalReports } = await admin
    .from("daily_reports")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);

  const isAdmin =
    session.user.role === "super_admin" || session.user.role === "org_admin";

  return (
    <DashboardView
      userName={session.user.name}
      isAdmin={isAdmin}
      totalReportsAllTime={totalReports ?? 0}
      monthTotal={monthTotal}
      monthPending={monthPending}
      branchCount={branches.length}
      submittedTodayCount={todayReports.length}
      pendingCount={reports.filter((r) => r.status === "submitted").length}
      byType={byType}
      pending={pending.map((p) => {
        const b = Array.isArray(p.branches) ? p.branches[0] : p.branches;
        const branchRel = b as
          | { name?: string; code?: string; business_type?: string }
          | null;
        return {
          id: p.id as string,
          branchName: branchRel?.name ?? "—",
          branchCode: branchRel?.code ?? "—",
          businessType: branchRel?.business_type ?? "—",
          shift: p.shift as string,
          totalSales: Number(p.total_sales || 0),
        };
      })}
    />
  );
}
