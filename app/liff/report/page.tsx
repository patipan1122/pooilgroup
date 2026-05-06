import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { adminClient } from "@/lib/db/server";
import { loadManageableBranches } from "@/lib/auth/branch-access";
import { bkkToday } from "@/lib/utils/format";
import { BranchPicker, type PickerBranch } from "./branch-picker";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  org_admin: "Admin",
  admin: "Admin",
  branch_manager: "ผู้จัดการสาขา",
  area_manager: "ผู้จัดการเขต",
  staff: "Staff",
  driver: "Driver",
  viewer: "Viewer",
};

export default async function LiffReportEntryPage() {
  const session = await requireSession();
  const admin = adminClient();

  const branches = await loadManageableBranches(session.user);
  const activeBranches = branches.filter((b) => b.is_active);

  // 1 branch → redirect direct (no picker needed)
  if (activeBranches.length === 1) {
    redirect(`/liff/report/${activeBranches[0]!.id}`);
  }

  if (activeBranches.length === 0) {
    return (
      <div className="p-6 max-w-md mx-auto text-center">
        <div className="text-5xl mb-4">🤷‍♀️</div>
        <h1 className="font-semibold text-lg mb-2">บัญชียังไม่ได้ผูกสาขา</h1>
        <p className="text-sm text-zinc-500 mb-6">
          กรุณาติดต่อผู้ดูแลให้กำหนดสาขาให้คุณ
        </p>
      </div>
    );
  }

  // Today's reports for these branches → show "filled" badge
  const today = bkkToday();
  const branchIds = activeBranches.map((b) => b.id);
  const { data: reports } = await admin
    .from("daily_reports")
    .select("branch_id, status")
    .eq("org_id", session.user.org_id)
    .eq("report_date", today)
    .in("branch_id", branchIds);

  const todayMap = Object.fromEntries(
    (reports ?? []).map((r) => [r.branch_id as string, r.status as string]),
  );

  const pickerBranches: PickerBranch[] = activeBranches.map((b) => ({
    id: b.id,
    code: b.code,
    name: b.name,
    business_type: b.business_type,
    province: b.province,
    todayStatus: todayMap[b.id] ?? null,
  }));

  return (
    <BranchPicker
      branches={pickerBranches}
      userName={session.user.name}
      roleLabel={ROLE_LABEL[session.user.role] ?? session.user.role}
    />
  );
}
