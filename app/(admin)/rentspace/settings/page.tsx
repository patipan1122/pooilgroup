import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { userIsModuleAdmin } from "@/lib/auth/module-access";
import { getPrimaryProject } from "@/lib/rentspace/data";
import { toNum } from "@/lib/rentspace/format";
import { prisma } from "@/lib/prisma";
import { RsPage, RsHeader } from "@/components/rentspace/ui";
import SettingsForm from "./_components/settings-form";

export const dynamic = "force-dynamic";

export default async function RentSpaceSettingsPage() {
  const session = await requireSession();
  // เปิดให้แอดมินโมดูลเช่า (program admin) เข้าตั้งค่าได้ · ไม่ใช่แค่ super admin
  if (!(await userIsModuleAdmin(session.user, "rentspace"))) redirect("/403");
  // แต่สวิตช์ปลดล็อก (แก้/ลบ/ออกบิล·สัญญา) ตั้งได้เฉพาะ super admin (กัน self-escalation)
  const canEditPerms = isSuperAdmin(session.user.role);

  const project = await getPrimaryProject(session.user.org_id);

  // ค่าใช้จ่ายประจำ (recurring charges) ของโครงการนี้ — โหลดเฉพาะเมื่อมีโครงการแล้ว
  const recurringCharges = project
    ? (
        await prisma.rentalRecurringCharge.findMany({
          where: { projectId: project.id, orgId: session.user.org_id },
          orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
          include: { unit: { select: { code: true, name: true } } },
        })
      ).map((c) => ({
        id: c.id,
        unitId: c.unitId,
        kind: c.kind,
        label: c.label,
        amountThb: toNum(c.amountThb),
        vatable: c.vatable,
        isActive: c.isActive,
        sort: c.sort,
        unitCode: c.unit?.code ?? null,
        unitName: c.unit?.name ?? null,
      }))
    : [];

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
        vatOnRent: project.vatOnRent,
        vatOnElectric: project.vatOnElectric,
        vatOnWater: project.vatOnWater,
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
        contractEditUnlocked: project.contractEditUnlocked,
        contractDeleteUnlocked: project.contractDeleteUnlocked,
        bankName: project.bankName ?? "",
        bankAccountNo: project.bankAccountNo ?? "",
        bankAccountHolder: project.bankAccountHolder ?? "",
        promptpayId: project.promptpayId ?? "",
        paymentNote: project.paymentNote ?? "",
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
      <SettingsForm initial={initial} recurringCharges={recurringCharges} canEditPerms={canEditPerms} />
    </RsPage>
  );
}
