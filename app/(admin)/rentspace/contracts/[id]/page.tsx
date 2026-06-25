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
  BillingTermsEditor,
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

// ผู้ให้เช่า (lessor) — fixed for โครงการทะเลทาวน์ / เจพี ซิงค์ กรุ๊ป
const LESSOR_NAME = "บริษัท เจพี ซิงค์ กรุ๊ป จำกัด";
const LESSOR_PROJECT = "โครงการทะเลทาวน์";

/** mask an id-card / tax id → show only last 4 digits */
function maskId(raw?: string | null): string {
  if (!raw) return "—";
  const digits = raw.replace(/\D/g, "");
  if (digits.length <= 4) return raw;
  return `${"x".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

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

  // ─── A4 document fields ───
  const tenantName = tenantDisplayName(contract.tenant);
  const tenantPhone = contract.tenant.phones?.[0] ?? "—";
  const tenantId = maskId(contract.tenant.idCardNo ?? contract.tenant.taxId);
  const rent = toNum(contract.rentAmountThb);
  const deposit = toNum(contract.depositAmountThb);
  const depositMonths = toNum(contract.depositMonths);
  const electricRate =
    contract.electricRate != null ? toNum(contract.electricRate) : toNum(contract.project.electricRate);
  const waterRate =
    contract.waterRate != null ? toNum(contract.waterRate) : toNum(contract.project.waterRate);
  const unitLabel = `${contract.unit.code}${contract.unit.name ? ` · ${contract.unit.name}` : ""}`;
  const docNo = contract.contractNo;
  const lateFeeLine =
    contract.lateFeeType !== "none"
      ? `${LATE_FEE_LABELS[contract.lateFeeType]} ${formatBaht(toNum(contract.lateFeeValue))} (ผ่อนผัน ${contract.lateFeeGraceDays} วัน)`
      : null;

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

          {/* ─────────── printable A4 document ─────────── */}
          <RsCard className="p-0 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b rs-noprint" style={{ borderColor: "var(--rs-border)" }}>
              <h2 className="font-bold" style={{ color: "var(--rs-text)" }}>
                เอกสารสัญญา (A4)
              </h2>
              <PrintButton />
            </div>

            <div id="rs-contract" className="rs-a4">
              {/* document title */}
              <div className="rs-a4-title">
                <div className="rs-a4-h1">สัญญาเช่าพื้นที่</div>
                <div className="rs-a4-sub">
                  {LESSOR_PROJECT} · เลขที่สัญญา {docNo}
                </div>
                <div className="rs-a4-sub">ทำ ณ วันที่ {thaiDateLong(new Date())}</div>
              </div>

              {/* parties */}
              <div className="rs-a4-parties">
                <div className="rs-a4-party">
                  <div className="rs-a4-party-h">ผู้ให้เช่า (เจ้าของพื้นที่)</div>
                  <div className="rs-a4-party-name">{LESSOR_NAME}</div>
                  <div className="rs-a4-party-line">{LESSOR_PROJECT}</div>
                  {contract.project.address && (
                    <div className="rs-a4-party-line">{contract.project.address}</div>
                  )}
                </div>
                <div className="rs-a4-party">
                  <div className="rs-a4-party-h">ผู้เช่า</div>
                  <div className="rs-a4-party-name">{tenantName}</div>
                  <div className="rs-a4-party-line">เลขประจำตัว: {tenantId}</div>
                  <div className="rs-a4-party-line">โทร: {tenantPhone}</div>
                </div>
              </div>

              <p className="rs-a4-intro">
                คู่สัญญาทั้งสองฝ่ายตกลงทำสัญญาเช่าพื้นที่ตามข้อกำหนดและเงื่อนไขดังต่อไปนี้
              </p>

              {/* custom template body (if super_admin authored one) replaces the clauses */}
              {docBody ? (
                <div
                  className="rs-a4-custom"
                  // เนื้อหามาจากแม่แบบที่ super_admin สร้างเอง (ไม่ใช่ user input ทั่วไป)
                  dangerouslySetInnerHTML={{ __html: docBody }}
                />
              ) : (
                <ol className="rs-a4-clauses">
                  <li>
                    <b>ห้อง / วัตถุประสงค์การเช่า</b> — ผู้ให้เช่าตกลงให้เช่าพื้นที่ห้อง {unitLabel} ภายใน
                    {" "}{contract.project.name} เพื่อใช้ประกอบกิจการของผู้เช่าตามที่ได้แจ้งไว้ ผู้เช่าจะไม่นำพื้นที่
                    ไปให้ผู้อื่นเช่าช่วงโดยไม่ได้รับความยินยอมเป็นลายลักษณ์อักษรจากผู้ให้เช่า
                  </li>
                  <li>
                    <b>ค่าเช่า เงินประกัน และส่วนลด</b> — ค่าเช่าเดือนละ {formatBaht(rent)}
                    {toNum(contract.vatPercent) > 0 ? ` (รวมภาษีมูลค่าเพิ่ม ${toNum(contract.vatPercent)}%)` : ""}
                    {" "}ผู้เช่าวางเงินประกันจำนวน {formatBaht(deposit)}
                    {depositMonths ? ` (เทียบเท่า ${depositMonths} เดือน)` : ""} ซึ่งผู้ให้เช่าจะคืนเมื่อสิ้นสุดสัญญา
                    หลังหักค่าเสียหาย (ถ้ามี)
                    {schedule.length > 0 ? " ทั้งนี้ค่าเช่าอาจปรับตามตารางแนบท้ายสัญญา" : ""}
                  </li>
                  <li>
                    <b>ระยะเวลาและการชำระเงิน</b> — สัญญานี้มีกำหนดตั้งแต่ {thaiDateLong(contract.startDate)} ถึง
                    {" "}{contract.endDate ? thaiDateLong(contract.endDate) : "ไม่มีกำหนด"} ผู้เช่าตกลงชำระค่าเช่า
                    ภายในวันที่ {contract.rentDueDay} ของทุกเดือน
                    {lateFeeLine ? ` หากชำระล่าช้าจะมีค่าปรับ ${lateFeeLine}` : ""}
                  </li>
                  <li>
                    <b>ค่าน้ำ–ค่าไฟ</b> — ผู้เช่าเป็นผู้รับผิดชอบค่าน้ำและค่าไฟฟ้าตามที่ใช้จริง โดยคิดอัตรา
                    {" "}ค่าไฟหน่วยละ {formatBaht(electricRate)} และค่าน้ำหน่วยละ {formatBaht(waterRate)}
                    {" "}ตามที่จดมิเตอร์ในแต่ละงวด
                  </li>
                </ol>
              )}

              {/* attachments */}
              <div className="rs-a4-attach">
                เอกสารแนบ: สำเนาบัตรประชาชน/ทะเบียนพาณิชย์ผู้เช่า
                {schedule.length > 0 ? " · ตารางปรับค่าเช่ารายงวด" : ""}
                {contract.note ? ` · หมายเหตุ: ${contract.note}` : ""}
              </div>

              {/* signatures */}
              <div className="rs-a4-signs">
                <div className="rs-a4-sign">
                  <div className="rs-a4-sign-space" />
                  <div className="rs-a4-sign-line" />
                  <div className="rs-a4-sign-role">ผู้ให้เช่า</div>
                  <div className="rs-a4-sign-name">( {LESSOR_NAME} )</div>
                </div>
                <div className="rs-a4-sign">
                  {contract.tenantSigned && contract.signatureDataUrl ? (
                    <div className="rs-a4-sign-img">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={contract.signatureDataUrl} alt="ลายเซ็นผู้เช่า" />
                    </div>
                  ) : (
                    <div className="rs-a4-sign-space" />
                  )}
                  <div className="rs-a4-sign-line" />
                  <div className="rs-a4-sign-role">ผู้เช่า</div>
                  <div className="rs-a4-sign-name">
                    ( {contract.tenantSigned ? contract.signerName ?? tenantName : tenantName} )
                  </div>
                  {contract.tenantSigned && (
                    <div className="rs-a4-sign-stamp">
                      ลงนามออนไลน์แล้ว{contract.signedAt ? ` · ${thaiDateLong(contract.signedAt)}` : ""}
                    </div>
                  )}
                </div>
              </div>
            </div>
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

          <RsCard className="p-5 space-y-2">
            <PrintButton />
            {contract.status !== "terminated" && <TerminateButton contractId={contract.id} />}
          </RsCard>
        </div>
      </div>

      <style>{`
        /* ── on-screen A4 preview ── */
        #rs-contract.rs-a4 {
          background: #fff;
          color: #111;
          max-width: 794px;
          margin: 0 auto;
          padding: 28px 32px 36px;
          font-size: 14px;
          line-height: 1.7;
        }
        .rs-a4-title { text-align: center; margin-bottom: 22px; }
        .rs-a4-h1 { font-size: 22px; font-weight: 800; letter-spacing: .5px; }
        .rs-a4-sub { font-size: 12.5px; color: #555; margin-top: 2px; }
        .rs-a4-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
        .rs-a4-party { border: 1px solid #ddd; border-radius: 8px; padding: 12px 14px; }
        .rs-a4-party-h { font-size: 11.5px; font-weight: 700; color: #777; text-transform: uppercase; margin-bottom: 4px; }
        .rs-a4-party-name { font-size: 15px; font-weight: 700; }
        .rs-a4-party-line { font-size: 12.5px; color: #444; margin-top: 1px; }
        .rs-a4-intro { margin: 14px 0 8px; }
        .rs-a4-clauses { padding-left: 22px; margin: 0; }
        .rs-a4-clauses > li { margin-bottom: 12px; text-align: justify; }
        .rs-a4-custom { margin: 8px 0; }
        .rs-a4-attach { margin-top: 18px; padding-top: 12px; border-top: 1px dashed #ccc; font-size: 12.5px; color: #555; }
        .rs-a4-signs { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 48px; }
        .rs-a4-sign { text-align: center; }
        .rs-a4-sign-space { height: 48px; }
        .rs-a4-sign-img { height: 48px; display: flex; align-items: flex-end; justify-content: center; }
        .rs-a4-sign-img img { max-height: 48px; max-width: 180px; }
        .rs-a4-sign-line { border-top: 1px solid #333; margin: 0 12px; }
        .rs-a4-sign-role { font-size: 13px; font-weight: 600; margin-top: 6px; }
        .rs-a4-sign-name { font-size: 12.5px; color: #444; margin-top: 2px; }
        .rs-a4-sign-stamp { font-size: 11.5px; color: #1a7f37; margin-top: 4px; font-weight: 600; }

        /* ── phone: A4 preview readable (stack party/sign boxes; tighter padding) ── */
        @media (max-width: 640px) {
          #rs-contract.rs-a4 { padding: 18px 16px 24px; }
          .rs-a4-parties { grid-template-columns: 1fr; gap: 10px; }
          .rs-a4-signs { grid-template-columns: 1fr; gap: 28px; margin-top: 32px; }
        }

        @media print {
          @page { size: A4; margin: 14mm; }
          body { background: #fff; }
          body * { visibility: hidden; }
          #rs-contract, #rs-contract * { visibility: visible; }
          #rs-contract { position: absolute; inset: 0; max-width: none; margin: 0; padding: 0; }
          .rs-noprint { display: none !important; }
        }
      `}</style>
    </RsPage>
  );
}
