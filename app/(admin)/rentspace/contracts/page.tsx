import Link from "next/link";
import { FileText } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { RsPage, RsHeader, RsKpi, RsBadge, RsEmpty, RsCard, RsBackLink, RsMobileCard, RsField } from "@/components/rentspace/ui";
import { formatBaht, thaiDateLong, toNum, tenantDisplayName } from "@/lib/rentspace/format";
import { listContracts, getPrimaryProject, listUnitsWithState, listTenants, listTemplates } from "@/lib/rentspace/data";
import { ContractForm } from "./_components/contract-form";

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

  // ห้องที่เปิดทำสัญญาได้ = ว่าง/จอง
  const vacantUnits = units.filter((u) => u.status === "vacant" || u.status === "reserved");

  const newContractBtn = project ? (
    <ContractForm projectId={project.id} units={vacantUnits} tenants={tenants} templates={templates} />
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

      <div className="grid grid-cols-3 gap-3">
        <RsKpi label="สัญญาที่ใช้งาน" value={activeCount} tone="ok" />
        <RsKpi label="ใกล้หมดอายุ (45 วัน)" value={expiringCount} tone={expiringCount ? "pending" : undefined} />
        <RsKpi label="ร่าง" value={draftCount} />
      </div>

      {contracts.length === 0 ? (
        <RsEmpty
          icon="📄"
          title="ยังไม่มีสัญญา"
          hint="เริ่มทำสัญญาเช่าฉบับแรก แล้วส่งลิงก์ให้ผู้เช่าเซ็นออนไลน์ได้เลย"
          action={newContractBtn}
        />
      ) : (
        <>
        <RsCard className="overflow-hidden hidden lg:block">
          <div className="overflow-x-auto">
            <table className="rs-table w-full text-sm">
              <thead>
                <tr style={{ color: "var(--rs-text-2)" }} className="text-left text-[12.5px]">
                  <th className="px-4 py-2.5 font-semibold">เลขที่สัญญา</th>
                  <th className="px-4 py-2.5 font-semibold">ห้อง</th>
                  <th className="px-4 py-2.5 font-semibold">ผู้เช่า</th>
                  <th className="px-4 py-2.5 font-semibold text-right">ค่าเช่า/เดือน</th>
                  <th className="px-4 py-2.5 font-semibold">ระยะสัญญา</th>
                  <th className="px-4 py-2.5 font-semibold">สถานะ</th>
                  <th className="px-4 py-2.5 font-semibold text-center">เซ็นแล้ว</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => {
                  const showStatus =
                    (c.status === "active" || c.status === "expiring") && isExpiringSoon(c.endDate)
                      ? "expiring"
                      : c.status;
                  return (
                    <tr
                      key={c.id}
                      className="border-t hover:bg-[var(--rs-bg-2)] transition"
                      style={{ borderColor: "var(--rs-border)" }}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/rentspace/contracts/${c.id}`}
                          className="font-semibold inline-flex items-center gap-1.5"
                          style={{ color: "var(--rs-brand)" }}
                        >
                          <FileText className="h-3.5 w-3.5" /> {c.contractNo}
                        </Link>
                      </td>
                      <td className="px-4 py-3" style={{ color: "var(--rs-text)" }}>
                        {c.unit.code}
                        {c.unit.name ? <span style={{ color: "var(--rs-text-3)" }}> · {c.unit.name}</span> : null}
                      </td>
                      <td className="px-4 py-3" style={{ color: "var(--rs-text)" }}>
                        {tenantDisplayName(c.tenant)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: "var(--rs-text)" }}>
                        {formatBaht(toNum(c.rentAmountThb))}
                      </td>
                      <td className="px-4 py-3 text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
                        {thaiDateLong(c.startDate)}
                        {c.endDate ? ` – ${thaiDateLong(c.endDate)}` : " – ไม่มีกำหนด"}
                      </td>
                      <td className="px-4 py-3">
                        <RsBadge kind="contract" status={showStatus} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        {c.tenantSigned ? (
                          <span style={{ color: "var(--rs-ok)" }} className="font-bold">
                            ✓
                          </span>
                        ) : (
                          <span style={{ color: "var(--rs-text-3)" }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </RsCard>

        {/* Mobile: tappable cards (เลี่ยงตาราง 7 คอลัมน์ที่ล้นบนมือถือ) */}
        <div className="space-y-2 lg:hidden">
          {contracts.map((c) => {
            const showStatus =
              (c.status === "active" || c.status === "expiring") && isExpiringSoon(c.endDate)
                ? "expiring"
                : c.status;
            return (
              <RsMobileCard
                key={c.id}
                href={`/rentspace/contracts/${c.id}`}
                title={
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--rs-brand)" }} />
                      <span className="truncate">{c.contractNo}</span>
                    </div>
                    <div className="truncate text-[12px] font-normal" style={{ color: "var(--rs-text-3)" }}>
                      {c.unit.code}
                      {c.unit.name ? ` · ${c.unit.name}` : ""}
                    </div>
                  </div>
                }
                titleRight={<RsBadge kind="contract" status={showStatus} />}
              >
                <RsField label="ผู้เช่า" value={tenantDisplayName(c.tenant)} />
                <RsField label="ค่าเช่า/เดือน" value={formatBaht(toNum(c.rentAmountThb))} align="right" />
                <RsField
                  label="ระยะสัญญา"
                  value={`${thaiDateLong(c.startDate)}${c.endDate ? ` – ${thaiDateLong(c.endDate)}` : " – ไม่มีกำหนด"}`}
                  full
                />
                <RsField
                  label="เซ็นแล้ว"
                  value={c.tenantSigned ? "✓ เซ็นแล้ว" : "ยังไม่เซ็น"}
                  tone={c.tenantSigned ? "ok" : "muted"}
                />
              </RsMobileCard>
            );
          })}
        </div>
        </>
      )}
    </RsPage>
  );
}
