import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { requireSession } from "@/lib/auth/session";
import { RsPage, RsHeader, RsBadge, RsCard, RsBackLink } from "@/components/rentspace/ui";
import { formatBaht, thaiDateLong, toNum, tenantDisplayName, periodLabel } from "@/lib/rentspace/format";
import { getContract } from "@/lib/rentspace/data";
import { resolveContractBody } from "@/lib/rentspace/contract-doc";
import {
  SignLinkBox,
  PrintButton,
  TerminateButton,
  RecordDepositButton,
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

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host") ?? "";
  const origin = `${proto}://${host}`;

  const docBody = resolveContractBody(contract);
  const deposits = contract.deposits ?? [];
  const depositBalance = deposits.reduce(
    (s, d) => s + (d.kind === "collect" ? toNum(d.amountThb) : -toNum(d.amountThb)),
    0,
  );
  const schedule = Array.isArray(contract.rentSchedule)
    ? (contract.rentSchedule as { fromPeriod: string; amount: number }[])
    : [];

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
          </div>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* left: terms */}
        <div className="lg:col-span-2 space-y-4">
          <RsCard className="p-5">
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

          {/* printable document */}
          {docBody && (
            <RsCard className="p-6">
              <div className="flex items-center justify-between mb-3 print:hidden">
                <h2 className="font-bold" style={{ color: "var(--rs-text)" }}>
                  เอกสารสัญญา
                </h2>
                <PrintButton />
              </div>
              <div
                className="rs-doc text-[14px] leading-relaxed"
                style={{ color: "var(--rs-text)" }}
                // เนื้อห้ามาจากแม่แบบที่ super_admin สร้างเอง (ไม่ใช่ user input ทั่วไป)
                dangerouslySetInnerHTML={{ __html: docBody }}
              />
            </RsCard>
          )}
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

          <RsCard className="p-5 space-y-2">
            <PrintButton />
            {contract.status !== "terminated" && <TerminateButton contractId={contract.id} />}
          </RsCard>
        </div>
      </div>

      <style>{`
        @media print {
          body { background: #fff; }
          .rs-doc { font-size: 13px; }
        }
      `}</style>
    </RsPage>
  );
}
