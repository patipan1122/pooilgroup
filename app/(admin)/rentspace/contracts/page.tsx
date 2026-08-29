import Link from "next/link";
import { requireSession } from "@/lib/auth/session";
import { RsPage, RsHeader, RsKpi, RsEmpty, RsBackLink } from "@/components/rentspace/ui";
import { formatBaht, thaiDateLong, toNum, tenantDisplayName } from "@/lib/rentspace/format";
import { listContracts, getPrimaryProject, listUnitsWithState, listTenants, listTemplates } from "@/lib/rentspace/data";
import { ContractForm } from "./_components/contract-form";
import { ContractsList, type ContractRow } from "./_components/contracts-list";

export const dynamic = "force-dynamic";

/** สัญญาที่ใกล้หมดอายุภายใน 45 วัน */
function isExpiringSoon(endDate: Date | null): boolean {
  if (!endDate) return false;
  const days = (new Date(endDate).getTime() - Date.now()) / 86400000;
  return days >= 0 && days <= 45;
}

export default async function ContractsPage() {
  const session = await requireSession();
  const orgId = session.user.org_id;

  const project = await getPrimaryProject(orgId);
  const [contracts, units, tenants, templates] = await Promise.all([
    listContracts(orgId, project?.id),
    project ? listUnitsWithState(orgId, project.id) : Promise.resolve([]),
    listTenants(orgId),
    listTemplates(orgId),
  ]);

  const activeCount = contracts.filter((c) => c.status === "active" || c.status === "expiring").length;
  const expiringCount = contracts.filter(
    (c) => (c.status === "active" || c.status === "expiring") && isExpiringSoon(c.endDate),
  ).length;
  const draftCount = contracts.filter((c) => c.status === "draft").length;
  const termsPendingCount = contracts.filter(
    (c) => c.rentApprovalStatus === "pending" || c.discountApprovalStatus === "pending",
  ).length;

  // ห้องที่เปิดทำสัญญาได้ = ว่าง/จอง
  const vacantUnits = units.filter((u) => u.status === "vacant" || u.status === "reserved");

  // แถวสำหรับ list (ค้นหา/กรอง client-side) — จัดรูปแบบ + คำนวณสถานะแสดงผลฝั่ง server
  const rows: ContractRow[] = contracts.map((c) => ({
    id: c.id,
    contractNo: c.contractNo,
    unitCode: c.unit.code,
    unitName: c.unit.name ?? null,
    tenantName: tenantDisplayName(c.tenant),
    rentText: formatBaht(toNum(c.rentAmountThb)),
    rangeText: `${thaiDateLong(c.startDate)}${c.endDate ? ` – ${thaiDateLong(c.endDate)}` : " – ไม่มีกำหนด"}`,
    // วันเริ่ม/สิ้นสุดแบบดิบ (YYYY-MM-DD) — ให้ list กรองตามเดือนที่สัญญามีผลได้ฝั่ง client
    startISO: c.startDate.toISOString().slice(0, 10),
    endISO: c.endDate ? c.endDate.toISOString().slice(0, 10) : null,
    status: c.status,
    showStatus:
      (c.status === "active" || c.status === "expiring") && isExpiringSoon(c.endDate) ? "expiring" : c.status,
    tenantSigned: c.tenantSigned,
    editPending: c.editStatus === "pending",
    termsPending: c.rentApprovalStatus === "pending" || c.discountApprovalStatus === "pending",
  }));

  // ข้อมูลโครงการ/บัญชีรับเงิน → ส่งให้พรีวิวสัญญาในฟอร์ม
  const previewProject = project
    ? {
        name: project.name,
        billCompanyName: project.billCompanyName,
        address: project.address,
        bankName: project.bankName,
        bankAccountNo: project.bankAccountNo,
        bankAccountHolder: project.bankAccountHolder,
        promptpayId: project.promptpayId,
        paymentNote: project.paymentNote,
      }
    : { name: "" };

  const newContractBtn = project ? (
    <ContractForm projectId={project.id} project={previewProject} units={vacantUnits} tenants={tenants} templates={templates} />
  ) : null;

  return (
    <RsPage>
      <RsBackLink href="/rentspace" label="กลับหน้าหลัก" />
      <RsHeader
        title="สัญญาเช่า"
        subtitle={project?.name ?? undefined}
        action={
          <div className="flex items-center gap-2">
            <Link href="/rentspace/contracts/templates" className="rs-btn rs-btn-ghost">
              แม่แบบสัญญา
            </Link>
            {newContractBtn}
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <RsKpi label="สัญญาที่ใช้งาน" value={activeCount} tone="ok" />
        <RsKpi label="ใกล้หมดอายุ (45 วัน)" value={expiringCount} tone={expiringCount ? "pending" : undefined} />
        <RsKpi label="ร่าง" value={draftCount} />
        <RsKpi
          label="รออนุมัติค่าเช่า/ส่วนลด"
          value={termsPendingCount}
          tone={termsPendingCount ? "pending" : undefined}
        />
      </div>

      {contracts.length === 0 ? (
        <RsEmpty
          icon="📄"
          title="ยังไม่มีสัญญา"
          hint="เริ่มทำสัญญาเช่าฉบับแรก แล้วส่งลิงก์ให้ผู้เช่าเซ็นออนไลน์ได้เลย"
          action={newContractBtn}
        />
      ) : (
        <ContractsList rows={rows} />
      )}
    </RsPage>
  );
}
