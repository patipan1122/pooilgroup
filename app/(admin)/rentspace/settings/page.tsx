import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { isSuperAdmin } from "@/lib/auth/role-guards";
import { userIsModuleAdmin } from "@/lib/auth/module-access";
import { getPrimaryProject } from "@/lib/rentspace/data";
import { toNum } from "@/lib/rentspace/format";
import { prisma } from "@/lib/prisma";
import { adminClient } from "@/lib/db/server";
import { listCompanies, listBankAccounts } from "@/lib/cashhub/amazon-settlement-data";
import { getProjectReconcileSummary } from "@/lib/rentspace/ledger-push";
import { RsPage, RsHeader } from "@/components/rentspace/ui";
import SettingsForm from "./_components/settings-form";
import ReconcileAccountSection from "./_components/reconcile-account-section";
import { PermissionSection } from "./_components/permission-section";
import { getPermissionMatrix } from "@/lib/rentspace/permissions";

export const dynamic = "force-dynamic";

export default async function RentSpaceSettingsPage() {
  const session = await requireSession();
  // เปิดให้แอดมินโมดูลเช่า (program admin) เข้าตั้งค่าได้ · ไม่ใช่แค่ super admin
  if (!(await userIsModuleAdmin(session.user, "rentspace"))) redirect("/403");
  // แต่สวิตช์ปลดล็อก (แก้/ลบ/ออกบิล·สัญญา) ตั้งได้เฉพาะ super admin (กัน self-escalation)
  const canEditPerms = isSuperAdmin(session.user.role);

  // upspeed 2026-09-22: getPermissionMatrix ต้องการแค่ orgId (ไม่ต้องรอ project) →
  // ยิงพร้อม getPrimaryProject เลย แทนที่จะเป็นขั้นสุดท้ายแบบต่อเนื่อง (เดิม await
  // อยู่ท้าย JSX แยกจากทุกอย่างข้างบน — เพิ่ม stage รอเปล่าๆ อีก 1 ชั้น)
  const [project, permissionMatrix] = await Promise.all([
    getPrimaryProject(session.user.org_id),
    canEditPerms ? getPermissionMatrix(session.user.org_id) : Promise.resolve(null),
  ]);

  const [companies, bankAccounts, reconcileSummary, recurringChargesRaw] = project
    ? await Promise.all([
        listCompanies(adminClient(), session.user.org_id),
        listBankAccounts(adminClient(), session.user.org_id),
        getProjectReconcileSummary(session.user.org_id, project.id),
        prisma.rentalRecurringCharge.findMany({
          where: { projectId: project.id, orgId: session.user.org_id },
          orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
          include: { unit: { select: { code: true, name: true } } },
        }),
      ])
    : [[], [], null, []];

  const recurringCharges = recurringChargesRaw.map((c) => ({
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
  }));

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
      {project && reconcileSummary && (
        <ReconcileAccountSection
          projectId={project.id}
          companies={companies}
          bankAccounts={bankAccounts}
          currentCompanyId={project.companyId}
          currentBankAccountId={project.reconcileBankAccountId}
          summary={reconcileSummary}
        />
      )}
      {canEditPerms && permissionMatrix && <PermissionSection matrix={permissionMatrix} />}
    </RsPage>
  );
}
