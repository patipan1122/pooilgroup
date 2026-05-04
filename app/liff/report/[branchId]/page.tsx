import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { ReportForm } from "@/components/cashhub/report-form";
import { getBusinessType } from "@/constants/business-types";
import { bkkToday } from "@/lib/utils/format";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ branchId: string }>;
}

export default async function LiffReportFormPage({ params }: Props) {
  const session = await requireSession();
  const { branchId } = await params;
  const admin = adminClient();

  // Verify branch + user access
  const { data: branch } = await admin
    .from("branches")
    .select("id, org_id, code, name, business_type, is_active")
    .eq("id", branchId)
    .eq("org_id", session.user.org_id)
    .eq("is_active", true)
    .maybeSingle();

  if (!branch) notFound();

  const config = getBusinessType(branch.business_type);
  if (!config) notFound();

  // Check user has access to this branch
  const isAdmin =
    session.user.role === "super_admin" || session.user.role === "org_admin";
  if (!isAdmin) {
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

  return (
    <ReportForm
      branchId={branch.id}
      branchCode={branch.code}
      branchName={branch.name}
      config={config}
      reportDate={today}
    />
  );
}
