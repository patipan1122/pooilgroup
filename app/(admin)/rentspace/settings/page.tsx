import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { getPrimaryProject } from "@/lib/rentspace/data";
import { toNum } from "@/lib/rentspace/format";
import { RsPage, RsHeader } from "@/components/rentspace/ui";
import SettingsForm from "./_components/settings-form";

export const dynamic = "force-dynamic";

export default async function RentSpaceSettingsPage() {
  const session = await requireSession();
  if (!isSuperAdmin(session.user.role)) redirect("/403");

  const project = await getPrimaryProject(session.user.org_id);

  // Flatten Decimal/Date into plain values for the client component.
  const initial = project
    ? {
        id: project.id,
        name: project.name,
        slug: project.slug,
        address: project.address ?? "",
        description: project.description ?? "",
        planImageUrl: project.planImageUrl ?? "",
        electricRate: toNum(project.electricRate),
        waterRate: toNum(project.waterRate),
        vatPercent: toNum(project.vatPercent),
        billDueDay: project.billDueDay ?? 5,
        lateFeeType: project.lateFeeType as
          | "none"
          | "fixed"
          | "percent_total"
          | "per_day",
        lateFeeValue: toNum(project.lateFeeValue),
        lateFeeGraceDays: project.lateFeeGraceDays ?? 7,
        autoBillEnabled: project.autoBillEnabled,
        view3dEnabled: project.view3dEnabled,
        billEditUnlocked: project.billEditUnlocked,
        billDeleteUnlocked: project.billDeleteUnlocked,
        billIssueUnlocked: project.billIssueUnlocked,
        billCompanyName: project.billCompanyName ?? "",
        billTaxId: project.billTaxId ?? "",
        billBranch: project.billBranch ?? "",
        billAddress: project.billAddress ?? "",
      }
    : null;

  return (
    <RsPage>
      <RsHeader
        title="ตั้งค่าโครงการ"
        subtitle={
          initial
            ? `${initial.name} · กำหนดอัตราค่าน้ำ-ไฟ ค่าปรับ และการออกบิล`
            : "ตั้งค่าโครงการเช่าครั้งแรก เพื่อเริ่มใช้งานระบบ"
        }
      />
      <SettingsForm initial={initial} />
    </RsPage>
  );
}
