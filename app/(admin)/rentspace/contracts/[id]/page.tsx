import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier, isSuperAdmin } from "@/lib/auth/role-guards";
import { prisma } from "@/lib/prisma";
import { RsPage, RsHeader, RsBadge, RsCard, RsBackLink } from "@/components/rentspace/ui";
import { formatBaht, thaiDateLong, toNum, tenantDisplayName, periodLabel } from "@/lib/rentspace/format";
import { getContract, listUnitsWithState, listTenants, listTemplates } from "@/lib/rentspace/data";
import { docDataFromContract } from "@/lib/rentspace/contract-doc";
import { RentalContractDocument } from "@/components/rentspace/contract-document";
import { Pencil } from "lucide-react";
import { ContractForm } from "../_components/contract-form";
import {
  SignLinkBox,
  PrintButton,
  TerminateButton,
  RecordDepositButton,
  BillingTermsEditor,
  ContractEditRequest,
  DeleteContractButton,
  ContractAttachments,
} from "./_components/contract-detail-actions";

export const dynamic = "force-dynamic";

const LATE_FEE_LABELS: Record<string, string> = {
  none: "ไม่คิด",
  fixed: "คงที่",
  percent_total: "% ของยอดบิล",
  per_day: "ต่อวัน",
};
const DEPOSIT_KINDS: Record<string, string> = {
  collect: "รับเงินประกัน",
  refund: "คืนเงินประกัน",
  deduct: "หักจากประกัน",
  forfeit: "ยึดประกัน",
};

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <span className="text-[13px]" style={{ color: "var(--rs-text-2)" }}>
        {label}
      </span>
      <span className="text-[13.5px] font-medium text-right" style={{ color: "var(--rs-text)" }}>
        {value}
      </span>
    </div>
  );
}

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const contract = await getContract(session.user.org_id, id);
  if (!contract) notFound();

  // ประวัติฉบับแก้ไข (addendum) — เรียงตามลำดับที่ออก + เอกสารแนบสัญญา
  const [addenda, contractDocs] = await Promise.all([
    prisma.rentalContractAddendum.findMany({
      where: { orgId: session.user.org_id, contractId: id },
      orderBy: { seq: "asc" },
    }),
    prisma.rentalDocument.findMany({
      where: { orgId: session.user.org_id, ownerType: "contract", ownerId: id },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const editStatus = (contract.editStatus ?? "none") as "none" | "pending" | "approved" | "rejected";
  const role = session.user.role;
  // F7: ปุ่มลบต้องมีด่าน role — เปิดสิทธิ์ลบ (หรือ super) + ต้องเป็น admin tier เท่านั้น
  const canDelete = (!!contract.project.contractDeleteUnlocked || isSuperAdmin(role)) && isAdminTier(role);
  // F3: ปุ่ม "แก้ไขสัญญา" เห็นได้เมื่อ ยังไม่เซ็น / เปิดสิทธิ์แก้สัญญา / คำขอแก้อนุมัติแล้ว / super_admin
  const canEdit =
    !contract.tenantSigned ||
    !!contract.project.contractEditUnlocked ||
    editStatus === "approved" ||
    isSuperAdmin(role);

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host") ?? "";
  const origin = `${proto}://${host}`;

  const deposits = contract.deposits ?? [];
  const depositBalance = deposits.reduce(
    (s, d) => s + (d.kind === "collect" ? toNum(d.amountThb) : -toNum(d.amountThb)),
    0,
  );
  const schedule = Array.isArray(contract.rentSchedule)
    ? (contract.rentSchedule as { fromPeriod: string; amount: number }[])
    : [];

  // F3: ข้อมูลที่ ContractForm (โหมดแก้ไข) ต้องใช้ — โหลดเฉพาะเมื่อมีสิทธิ์แก้ (ไม่เปลือง query)
  const editData = canEdit
    ? await (async () => {
        const [units, tenants, templates] = await Promise.all([
          listUnitsWithState(session.user.org_id, contract.projectId),
          listTenants(session.user.org_id),
          listTemplates(session.user.org_id),
        ]);
        // ห้องที่เลือกได้ = ว่าง/จอง + ห้องปัจจุบันของสัญญานี้ (แม้สถานะ "เช่าอยู่" ก็ต้องเลือกได้)
        const selectable = units.filter(
          (u) => u.status === "vacant" || u.status === "reserved" || u.id === contract.unitId,
        );
        return { units: selectable, tenants, templates };
      })()
    : null;
  const previewProject = {
    name: contract.project.name,
    billCompanyName: contract.project.billCompanyName,
    address: contract.project.address,
    bankName: contract.project.bankName,
    bankAccountNo: contract.project.bankAccountNo,
    bankAccountHolder: contract.project.bankAccountHolder,
    promptpayId: contract.project.promptpayId,
    paymentNote: contract.project.paymentNote,
  };
  const editInitial = {
    id: contract.id,
    unitId: contract.unitId,
    tenantId: contract.tenantId,
    templateId: contract.templateId ?? null,
    contractDate: contract.contractDate ? contract.contractDate.toISOString().slice(0, 10) : null,
    startDate: contract.startDate.toISOString().slice(0, 10),
    endDate: contract.endDate ? contract.endDate.toISOString().slice(0, 10) : null,
    promoStartPeriod: contract.promoStartPeriod ?? null,
    rentAmountThb: toNum(contract.rentAmountThb),
    rentDueDay: contract.rentDueDay,
    depositAmountThb: toNum(contract.depositAmountThb),
    depositMonths: toNum(contract.depositMonths),
    vatPercent: toNum(contract.vatPercent),
    electricRate: contract.electricRate != null ? toNum(contract.electricRate) : null,
    waterRate: contract.waterRate != null ? toNum(contract.waterRate) : null,
    lateFeeType: contract.lateFeeType as "none" | "fixed" | "percent_total" | "per_day",
    lateFeeValue: toNum(contract.lateFeeValue),
    lateFeeGraceDays: contract.lateFeeGraceDays ?? 7,
    promoDiscountThb: toNum(contract.promoDiscountThb),
    promoMonths: contract.promoMonths ?? 0,
    billIssueDay: contract.billIssueDay ?? null,
    customTermsHtml: contract.customTermsHtml ?? null,
    note: contract.note ?? null,
    tenantSigned: contract.tenantSigned,
  };

  // ─── เอกสาร A4 ฉบับเต็ม (ใช้ component รวมศูนย์เดียวกับพรีวิว/หน้าเซ็น) ───
  // ป้ายเอกสารแนบที่อัปโหลด + ฉบับแก้ไข → โชว์ในบรรทัด "เอกสารแนบท้ายสัญญา"
  const attachmentLabels = [
    ...contractDocs.map((doc) => doc.label?.trim() || "เอกสารแนบ"),
    ...(addenda.length > 0 ? [`ฉบับแก้ไข ${addenda.length} ฉบับ`] : []),
  ];
  const docData = docDataFromContract(contract, { attachments: attachmentLabels });

  return (
    <RsPage>
      <div className="print:hidden">
        <RsBackLink href="/rentspace/contracts" label="กลับรายการสัญญา" />
      </div>
      <RsHeader
        title={`สัญญา ${contract.contractNo}`}
        subtitle={`${contract.project.name} · ห้อง ${contract.unit.code}`}
        action={
          <div className="flex items-center gap-2 print:hidden">
            <RsBadge kind="contract" status={contract.status} />
            {canEdit && editData && contract.status !== "terminated" && (
              <ContractForm
                projectId={contract.projectId}
                project={previewProject}
                units={editData.units}
                tenants={editData.tenants}
                templates={editData.templates}
                editInitial={editInitial}
                trigger={
                  <button className="rs-btn rs-btn-ghost min-h-[44px] sm:min-h-0">
                    <Pencil className="h-4 w-4" /> แก้ไขสัญญา
                  </button>
                }
              />
            )}
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* left: terms */}
        <div className="lg:col-span-2 space-y-4">
          <RsCard className="p-5 print:hidden">
            <h2 className="font-bold mb-3" style={{ color: "var(--rs-text)" }}>
              รายละเอียดสัญญา
            </h2>
            <div className="divide-y" style={{ borderColor: "var(--rs-border)" }}>
              <Row label="ผู้เช่า" value={tenantDisplayName(contract.tenant)} />
              <Row label="ห้อง / ยูนิต" value={`${contract.unit.code}${contract.unit.name ? ` · ${contract.unit.name}` : ""}`} />
              <Row label="ค่าเช่า/เดือน" value={formatBaht(toNum(contract.rentAmountThb))} />
              <Row label="ครบกำหนดชำระ" value={`วันที่ ${contract.rentDueDay} ของเดือน`} />
              <Row
                label="ระยะสัญญา"
                value={`${thaiDateLong(contract.startDate)} – ${contract.endDate ? thaiDateLong(contract.endDate) : "ไม่มีกำหนด"}`}
              />
              <Row label="เงินประกัน" value={`${formatBaht(toNum(contract.depositAmountThb))}${toNum(contract.depositMonths) ? ` (${toNum(contract.depositMonths)} เดือน)` : ""}`} />
              {toNum(contract.vatPercent) > 0 && <Row label="VAT" value={`${toNum(contract.vatPercent)}%`} />}
              {contract.lateFeeType !== "none" && (
                <Row
                  label="ค่าปรับล่าช้า"
                  value={`${LATE_FEE_LABELS[contract.lateFeeType]} ${formatBaht(toNum(contract.lateFeeValue))} (ผ่อนผัน ${contract.lateFeeGraceDays} วัน)`}
                />
              )}
              {(contract.electricRate != null || contract.waterRate != null) && (
                <Row
                  label="ค่าน้ำ/ไฟ"
                  value={`ไฟ ${contract.electricRate != null ? formatBaht(toNum(contract.electricRate)) : "ตามโครงการ"} · น้ำ ${contract.waterRate != null ? formatBaht(toNum(contract.waterRate)) : "ตามโครงการ"}`}
                />
              )}
            </div>

            {schedule.length > 0 && (
              <div className="mt-4">
                <div className="text-[13px] font-semibold mb-1.5" style={{ color: "var(--rs-text)" }}>
                  การปรับค่าเช่าตามงวด
                </div>
                <div className="space-y-1">
                  {schedule.map((s, i) => (
                    <div key={i} className="flex justify-between text-[13px]">
                      <span style={{ color: "var(--rs-text-2)" }}>ตั้งแต่ {periodLabel(s.fromPeriod)}</span>
                      <span className="font-medium" style={{ color: "var(--rs-text)" }}>
                        {formatBaht(s.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {contract.note && (
              <p className="mt-4 text-[13px]" style={{ color: "var(--rs-text-2)" }}>
                หมายเหตุ: {contract.note}
              </p>
            )}
          </RsCard>

          {/* deposits ledger */}
          <RsCard className="p-5 print:hidden">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold" style={{ color: "var(--rs-text)" }}>
                บัญชีเงินประกัน
              </h2>
              <span className="text-[13px] font-semibold" style={{ color: "var(--rs-text)" }}>
                คงเหลือ {formatBaht(depositBalance)}
              </span>
            </div>
            {deposits.length === 0 ? (
              <p className="text-[13px]" style={{ color: "var(--rs-text-3)" }}>
                ยังไม่มีรายการเงินประกัน
              </p>
            ) : (
              <div className="space-y-1.5">
                {deposits.map((d) => (
                  <div key={d.id} className="flex items-center justify-between py-1.5 border-b last:border-0" style={{ borderColor: "var(--rs-border)" }}>
                    <div>
                      <div className="text-[13.5px] font-medium" style={{ color: "var(--rs-text)" }}>
                        {DEPOSIT_KINDS[d.kind] ?? d.kind}
                      </div>
                      <div className="text-[12px]" style={{ color: "var(--rs-text-3)" }}>
                        {thaiDateLong(d.occurredOn)}
                        {d.note ? ` · ${d.note}` : ""}
                        {d.slipUrl ? (
                          <>
                            {" · "}
                            <a href={d.slipUrl} target="_blank" rel="noreferrer" style={{ color: "var(--rs-brand)" }}>
                              สลิป
                            </a>
                          </>
                        ) : null}
                      </div>
                    </div>
                    <div
                      className="text-[13.5px] font-semibold tabular-nums"
                      style={{ color: d.kind === "collect" ? "var(--rs-ok)" : "var(--rs-danger)" }}
                    >
                      {d.kind === "collect" ? "+" : "−"}
                      {formatBaht(toNum(d.amountThb))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3">
              <RecordDepositButton contractId={contract.id} />
            </div>
          </RsCard>

          {/* เอกสารแนบประกอบสัญญา (สำเนาบัตร · ทะเบียนพาณิชย์ · เอกสารอื่น) */}
          <RsCard className="p-5 print:hidden">
            <ContractAttachments
              contractId={contract.id}
              documents={contractDocs.map((doc) => ({
                id: doc.id,
                label: doc.label,
                url: doc.url,
                mime: doc.mime,
                sizeBytes: doc.sizeBytes,
              }))}
            />
          </RsCard>

          {/* ─────────── printable A4 document ─────────── */}
          <RsCard className="p-0 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b rs-noprint" style={{ borderColor: "var(--rs-border)" }}>
              <h2 className="font-bold" style={{ color: "var(--rs-text)" }}>
                เอกสารสัญญา (A4)
              </h2>
              <PrintButton />
            </div>

            <RentalContractDocument data={docData} printId="rs-contract" />
          </RsCard>
        </div>

        {/* right: actions */}
        <div className="space-y-4 print:hidden">
          <RsCard className="p-5">
            <h2 className="font-bold mb-3" style={{ color: "var(--rs-text)" }}>
              ลิงก์เซ็นสัญญาออนไลน์
            </h2>
            {contract.tenantSigned ? (
              <div>
                <div className="text-[13px] mb-2" style={{ color: "var(--rs-ok)" }}>
                  ✓ เซ็นแล้วโดย <b>{contract.signerName}</b>
                  {contract.signedAt ? ` · ${thaiDateLong(contract.signedAt)}` : ""}
                </div>
                {contract.signatureDataUrl && (
                  <div className="rounded-lg p-2" style={{ border: "1px solid var(--rs-border)", background: "#fff" }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={contract.signatureDataUrl} alt="ลายเซ็นผู้เช่า" className="max-h-28 mx-auto" />
                  </div>
                )}
              </div>
            ) : (
              <SignLinkBox contractId={contract.id} origin={origin} initialToken={contract.signToken} />
            )}
          </RsCard>

          {contract.status !== "terminated" && (
            <RsCard className="p-5">
              <BillingTermsEditor
                contractId={contract.id}
                initial={{
                  lateFeeType: contract.lateFeeType as "none" | "fixed" | "percent_total" | "per_day",
                  lateFeeValue: toNum(contract.lateFeeValue),
                  lateFeeGraceDays: contract.lateFeeGraceDays ?? 7,
                  promoDiscountThb: toNum(contract.promoDiscountThb),
                  promoMonths: contract.promoMonths ?? 0,
                  promoStartPeriod: contract.promoStartPeriod ?? null,
                  billIssueDay: contract.billIssueDay ?? null,
                }}
              />
            </RsCard>
          )}

          {/* แก้ไขสัญญา (maker-checker) — เฉพาะสัญญาที่เซ็นแล้ว */}
          {contract.tenantSigned && contract.status !== "terminated" && (
            <RsCard className="p-5 space-y-3">
              <h2 className="font-bold" style={{ color: "var(--rs-text)" }}>
                แก้ไขสัญญา
              </h2>
              <ContractEditRequest
                contractId={contract.id}
                tenantSigned={contract.tenantSigned}
                editStatus={editStatus}
                editRequestReason={contract.editRequestReason}
                editDecisionNote={contract.editDecisionNote}
              />
            </RsCard>
          )}

          {/* ประวัติฉบับแก้ไข (addendum) */}
          {addenda.length > 0 && (
            <RsCard className="p-5">
              <h2 className="font-bold mb-3" style={{ color: "var(--rs-text)" }}>
                ประวัติฉบับแก้ไข
              </h2>
              <div className="space-y-2">
                {addenda.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-lg px-3 py-2"
                    style={{ border: "1px solid var(--rs-border)", background: "var(--rs-bg-2)" }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-semibold" style={{ color: "var(--rs-text)" }}>
                        ฉบับแก้ไขที่ {a.seq}
                      </span>
                      <span className="text-[11.5px]" style={{ color: "var(--rs-text-3)" }}>
                        {thaiDateLong(a.createdAt)}
                      </span>
                    </div>
                    {a.summary && (
                      <div className="text-[12.5px] mt-0.5" style={{ color: "var(--rs-text-2)" }}>
                        {a.summary}
                      </div>
                    )}
                    <div className="text-[11.5px] mt-1" style={{ color: a.tenantSigned ? "var(--rs-ok)" : "var(--rs-text-3)" }}>
                      {a.tenantSigned
                        ? `เซ็นแล้ว${a.signerName ? ` · ${a.signerName}` : ""}${a.signedAt ? ` · ${thaiDateLong(a.signedAt)}` : ""}`
                        : "ยังไม่เซ็น"}
                    </div>
                  </div>
                ))}
              </div>
            </RsCard>
          )}

          <RsCard className="p-5 space-y-2">
            <PrintButton />
            {contract.status !== "terminated" && <TerminateButton contractId={contract.id} />}
            {canDelete && <DeleteContractButton contractId={contract.id} />}
          </RsCard>
        </div>
      </div>

      <style>{`
        /* เอกสาร A4 บนจอ = จัดกึ่งกลางกว้างเท่า A4 (เนื้อในสไตล์มาจาก RentalContractDocument) */
        #rs-contract { max-width: 794px; margin: 0 auto; }

        @media print {
          @page { size: A4; margin: 14mm; }
          body { background: #fff; }
          body * { visibility: hidden; }
          #rs-contract, #rs-contract * { visibility: visible; }
          #rs-contract { position: absolute; top: 0; left: 0; right: 0; max-width: none; margin: 0; padding: 0; }
          .rs-noprint { display: none !important; }
        }
      `}</style>
    </RsPage>
  );
}
