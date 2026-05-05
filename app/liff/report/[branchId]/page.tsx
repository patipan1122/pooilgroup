import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { ReportForm } from "@/components/cashhub/report-form";
import {
  getBusinessType,
  type BusinessTypeKey,
} from "@/constants/business-types";
import { getEffectiveBusinessTypeConfig } from "@/lib/cashhub/form-config";
import {
  composeFieldsFromTemplate,
  ensureDefaultTemplate,
  getTemplate,
  getDefaultTemplate,
} from "@/lib/cashhub/form-templates";
import { bkkToday } from "@/lib/utils/format";
import { subDays } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";

export const dynamic = "force-dynamic";

const TZ = process.env.NEXT_PUBLIC_APP_TIMEZONE || "Asia/Bangkok";

interface Props {
  params: Promise<{ branchId: string }>;
}

export default async function LiffReportFormPage({ params }: Props) {
  const session = await requireSession();
  const { branchId } = await params;
  const admin = adminClient();

  // Verify branch + user access
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: branch } = await (admin.from as any)("branches")
    .select(
      "id, org_id, code, name, business_type, is_active, report_deadline, form_template_id",
    )
    .eq("id", branchId)
    .eq("org_id", session.user.org_id)
    .eq("is_active", true)
    .maybeSingle();

  if (!branch) notFound();

  const baseConfig = getBusinessType(branch.business_type);
  if (!baseConfig) notFound();

  // Resolve form config from template (Free mode):
  //   1. branch.form_template_id → use that template
  //   2. else → org's default template for this business type
  //   3. else → fallback to legacy org settings.formOverrides
  const businessType = branch.business_type as BusinessTypeKey;
  let template = null;
  if (branch.form_template_id) {
    template = await getTemplate(session.user.org_id, branch.form_template_id);
  }
  if (!template) {
    template =
      (await getDefaultTemplate(session.user.org_id, businessType)) ??
      (await ensureDefaultTemplate(
        session.user.org_id,
        businessType,
        session.user.id,
      ));
  }

  let config = composeFieldsFromTemplate(template);
  if (!config) {
    // legacy fallback (should not normally happen post-migration)
    const { data: org } = await admin
      .from("organizations")
      .select("settings")
      .eq("id", session.user.org_id)
      .single();
    const orgSettings = (org?.settings as Record<string, unknown>) ?? null;
    config =
      getEffectiveBusinessTypeConfig(businessType, orgSettings) ?? baseConfig;
  }

  // Check user has access to this branch
  // Cross-branch roles (super_admin / org_admin / admin / area_manager)
  // can fill any branch in same org. Others need user_branches link.
  const hasCrossBranch =
    session.user.role === "super_admin" ||
    session.user.role === "org_admin" ||
    session.user.role === "admin" ||
    session.user.role === "area_manager";

  if (!hasCrossBranch) {
    const { data: link } = await admin
      .from("user_branches")
      .select("id")
      .eq("user_id", session.user.id)
      .eq("branch_id", branchId)
      .eq("is_active", true)
      .maybeSingle();
    if (!link) redirect("/liff/report");
  }

  const today = bkkToday();
  const yesterday = formatInTimeZone(subDays(new Date(), 1), TZ, "yyyy-MM-dd");

  // Pull yesterday's report (any shift) for "เมื่อวาน ฿X" hint
  const { data: yesterdayReports } = await admin
    .from("daily_reports")
    .select("total_sales, qty1, shift, status")
    .eq("branch_id", branchId)
    .eq("report_date", yesterday)
    .eq("status", "approved");
  const previousReference = yesterdayReports
    ? yesterdayReports.reduce(
        (acc, r) => ({
          totalSales: acc.totalSales + Number(r.total_sales || 0),
          qty1: acc.qty1 + Number(r.qty1 || 0),
        }),
        { totalSales: 0, qty1: 0 },
      )
    : { totalSales: 0, qty1: 0 };

  // Streak from branch_streaks (or compute fallback)
  let streakInfo: { current: number; lastDate: string | null } | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const streakQ = await (admin.from as any)("branch_streaks")
    .select("current_streak, last_report_date")
    .eq("branch_id", branchId)
    .maybeSingle();
  if (streakQ.data) {
    streakInfo = {
      current: streakQ.data.current_streak,
      lastDate: streakQ.data.last_report_date,
    };
  }

  return (
    <ReportForm
      branchId={branch.id}
      branchCode={branch.code}
      branchName={branch.name}
      config={config}
      reportDate={today}
      deadlineHHmm={branch.report_deadline ?? "21:00"}
      previousReference={previousReference}
      streak={streakInfo}
    />
  );
}
