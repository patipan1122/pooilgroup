import { notFound } from "next/navigation";
import { Zap, Droplet, Landmark } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier, isSuperAdmin } from "@/lib/auth/role-guards";
import { userIsModuleAdmin } from "@/lib/auth/module-access";
import { RsPage, RsHeader, RsBadge, RsCard, RsBackLink } from "@/components/rentspace/ui";
import {
  formatBaht,
  thaiDateLong,
  toNum,
  tenantDisplayName,
  periodLabel,
  PAYMENT_METHODS,
} from "@/lib/rentspace/format";
import { getBill } from "@/lib/rentspace/data";
import { loadBillMeterReadings, projectBankInfo } from "@/lib/rentspace/bill-extras";
import { getBaseUrl } from "@/lib/utils/base-url";
import {
  RecordPaymentButton,
  RequestDiscountButton,
  DiscountDecisionButtons,
  PrintBillButton,
  SendBillButton,
  RequestVoidButton,
  VoidDecisionButtons,
  EditBillButton,
  DeleteBillButton,
} from "./_components/bill-detail-actions";

export const dynamic = "force-dynamic";

const ITEM_KIND_LABELS: Record<string, string> = {
  rent: "ค่าเช่า",
  electric: "ค่าไฟ",
  water: "ค่าน้ำ",
  late_fee: "ค่าปรับล่าช้า",
  discount: "ส่วนลด",
  other: "อื่น ๆ",
};

function TotalRow({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
  tone?: "danger" | "ok";
}) {
  const color = tone === "danger" ? "var(--rs-danger)" : tone === "ok" ? "var(--rs-ok)" : "var(--rs-text)";
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <span className={strong ? "text-[14px] font-semibold" : "text-[13px]"} style={{ color: strong ? "var(--rs-text)" : "var(--rs-text-2)" }}>
        {label}
      </span>
      <span
        className={`tabular-nums text-right ${strong ? "text-[15px] font-bold" : "text-[13.5px] font-medium"}`}
        style={{ color: strong ? color : "var(--rs-text)" }}
      >
        {value}
      </span>
    </div>
  );
}

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const isAdmin = isAdminTier(session.user.role);
  const isSuper = isSuperAdmin(session.user.role);
  // แก้ไข/ลบบิล: ผู้ดูแล (admin + program_admin ของ rentspace) เมื่อ super เปิดสวิตช์
  // ในหน้าตั้งค่า · super_admin ทำได้เสมอไม่ต้องเปิดสวิตช์
  const canOperate = isAdmin || (await userIsModuleAdmin(session.user, "rentspace"));
  const bill = await getBill(session.user.org_id, id);
  if (!bill) notFound();
  // เลขมิเตอร์ก่อน→หลังของงวดนี้ + ช่องทางชำระเงิน (โชว์บนใบบิลให้ตรวจ/จ่ายง่าย)
  const meterReadings = await loadBillMeterReadings(prisma, bill.unitId, bill.period);
  const bank = projectBankInfo(bill.project);
  const canEditBill = isSuper || (bill.project.billEditUnlocked && canOperate);
  const canDeleteBill = isSuper || (bill.project.billDeleteUnlocked && canOperate);

  const total = toNum(bill.totalAmount);
  const paid = toNum(bill.paidAmount);
  const remaining = Math.max(0, total - paid);
  const discountTotal = toNum(bill.discountAmount);
  const vat = toNum(bill.vatAmount);
  const subtotal = toNum(bill.subtotal);

  const items = bill.items ?? [];
  const payments = bill.payments ?? [];
  const discounts = bill.discounts ?? [];
  const canEdit = bill.status !== "void" && bill.status !== "paid";

  return (
    <RsPage>
      <div className="print:hidden">
        <RsBackLink href="/rentspace/bills" label="กลับรายการบิล" />
      </div>
      <RsHeader
        title={`บิล ${bill.billNo}`}
        subtitle={`${bill.project.name} · ห้อง ${bill.unit.code} · ${periodLabel(bill.period)}`}
        action={
          <div className="flex items-center gap-2 print:hidden">
            <RsBadge kind="bill" status={bill.status} />
          </div>
        }
      />

      {bill.note && bill.note.includes("มิเตอร์") && (
        <div
          className="flex items-start gap-2.5 rounded-xl px-4 py-3 print:hidden"
          style={{ background: "var(--rs-pending-soft)", border: "1px solid #F6E0AE" }}
        >
          <span style={{ fontSize: 16 }}>⚠️</span>
          <div className="text-[12.5px]" style={{ color: "#8A6400" }}>
            <b>บิลนี้ยังไม่ครบ:</b> {bill.note} — ค่าน้ำ-ไฟจะเพิ่มได้ภายหลังเมื่อจดมิเตอร์ (ไปที่หน้า{" "}
            <a href="/rentspace/meters" className="underline font-semibold">จดมิเตอร์</a>)
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ───── invoice ───── */}
        <div className="lg:col-span-2 space-y-4">
          <RsCard className="p-6 rs-invoice">
           <div id="rs-bill">
            {/* paid / unpaid stamp */}
            <div className="rs-bill-stamp" data-state={remaining <= 0 && bill.status !== "void" ? "paid" : bill.status === "void" ? "void" : "unpaid"}>
              {bill.status === "void" ? "ยกเลิก" : remaining <= 0 ? "ชำระแล้ว" : "ค้างชำระ"}
            </div>

            {/* invoice header */}
            <div className="flex items-start justify-between gap-4 pb-4 mb-4 border-b" style={{ borderColor: "var(--rs-border)" }}>
              <div>
                <div className="text-xl font-bold" style={{ color: "var(--rs-text)" }}>
                  {bill.project.billCompanyName || bill.project.name}
                </div>
                {(bill.project.billAddress || bill.project.address) && (
                  <div className="text-[12.5px] mt-0.5" style={{ color: "var(--rs-text-3)" }}>
                    {bill.project.billAddress || bill.project.address}
                  </div>
                )}
                {bill.project.billTaxId && (
                  <div className="text-[12.5px] mt-0.5" style={{ color: "var(--rs-text-3)" }}>
                    เลขผู้เสียภาษี {bill.project.billTaxId}
                    {bill.project.billBranch ? ` · ${bill.project.billBranch}` : ""}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="text-[14px] font-bold" style={{ color: "var(--rs-text)" }}>
                  {remaining <= 0 && bill.status !== "void" ? "ใบเสร็จรับเงิน" : "ใบแจ้งหนี้"}
                </div>
                <div className="text-[13px]" style={{ color: "var(--rs-text-2)" }}>
                  เลขที่ {bill.billNo}
                </div>
                <div className="text-[12.5px] mt-0.5" style={{ color: "var(--rs-text-3)" }}>
                  งวด {periodLabel(bill.period)}
                </div>
              </div>
            </div>

            {/* bill-to + meta */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <div className="text-[11.5px] font-semibold uppercase mb-1" style={{ color: "var(--rs-text-3)" }}>
                  เรียกเก็บจาก
                </div>
                <div className="text-[14px] font-medium" style={{ color: "var(--rs-text)" }}>
                  {tenantDisplayName(bill.tenant)}
                </div>
                {bill.tenant.taxId && (
                  <div className="text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
                    เลขผู้เสียภาษี {bill.tenant.taxId}
                  </div>
                )}
                <div className="text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
                  ห้อง {bill.unit.code}
                  {bill.unit.name ? ` · ${bill.unit.name}` : ""}
                </div>
              </div>
              <div className="text-right text-[12.5px] space-y-0.5" style={{ color: "var(--rs-text-2)" }}>
                <div>
                  งวด: <b style={{ color: "var(--rs-text)" }}>{periodLabel(bill.period)}</b>
                </div>
                <div>วันที่ออกบิล: {bill.issueDate ? thaiDateLong(bill.issueDate) : "—"}</div>
                <div>
                  ครบกำหนด:{" "}
                  <b style={{ color: "var(--rs-text)" }}>{bill.dueDate ? thaiDateLong(bill.dueDate) : "—"}</b>
                </div>
              </div>
            </div>

            {/* items */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[12px] border-b" style={{ color: "var(--rs-text-2)", borderColor: "var(--rs-border)" }}>
                    <th className="py-2 font-semibold">รายการ</th>
                    <th className="py-2 font-semibold text-right">จำนวน × ราคา</th>
                    <th className="py-2 font-semibold text-right">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-[13px]" style={{ color: "var(--rs-text-3)" }}>
                        ไม่มีรายการย่อย
                      </td>
                    </tr>
                  ) : (
                    items.map((it) => (
                      <tr key={it.id} className="border-b last:border-0" style={{ borderColor: "var(--rs-border)" }}>
                        <td className="py-2.5" style={{ color: "var(--rs-text)" }}>
                          {it.label}
                          {it.kind && it.kind !== "other" ? (
                            <span className="text-[11.5px] ml-1.5" style={{ color: "var(--rs-text-3)" }}>
                              {ITEM_KIND_LABELS[it.kind] ?? it.kind}
                            </span>
                          ) : null}
                          {it.vatable ? (
                            <span
                              className="inline-flex items-center text-[10.5px] font-semibold ml-1.5 px-1.5 py-0.5 rounded"
                              style={{ background: "var(--rs-info-soft)", color: "var(--rs-info)" }}
                              title="รายการนี้คิดภาษีมูลค่าเพิ่ม"
                            >
                              VAT
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2.5 text-right tabular-nums text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
                          {toNum(it.qty)} × {formatBaht(toNum(it.unitPrice))}
                        </td>
                        <td
                          className="py-2.5 text-right tabular-nums font-medium"
                          style={{ color: toNum(it.amount) < 0 ? "var(--rs-ok)" : "var(--rs-text)" }}
                        >
                          {formatBaht(toNum(it.amount))}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* meter detail — เลขมิเตอร์ก่อน→หลัง ให้ตรวจค่าน้ำ-ไฟ */}
            {meterReadings && (
              <div
                className="mt-3 rounded-xl px-3.5 py-2.5"
                style={{ background: "var(--rs-bg-2)", border: "1px solid var(--rs-border)" }}
              >
                <div className="text-[11.5px] font-semibold uppercase mb-1.5" style={{ color: "var(--rs-text-3)" }}>
                  การอ่านมิเตอร์งวดนี้
                </div>
                <div className="space-y-1">
                  {meterReadings.electric && (
                    <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
                      <Zap className="h-3.5 w-3.5" style={{ color: "var(--rs-text-3)" }} />
                      <span style={{ color: "var(--rs-text)" }}>ไฟ:</span>
                      <span className="tabular-nums">
                        เลขก่อน <b style={{ color: "var(--rs-text)" }}>{meterReadings.electric.prev.toLocaleString()}</b> →{" "}
                        เลขหลัง <b style={{ color: "var(--rs-text)" }}>{meterReadings.electric.curr.toLocaleString()}</b> ={" "}
                        ใช้ <b style={{ color: "var(--rs-text)" }}>{meterReadings.electric.usage.toLocaleString()}</b> หน่วย
                      </span>
                    </div>
                  )}
                  {meterReadings.water && (
                    <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
                      <Droplet className="h-3.5 w-3.5" style={{ color: "var(--rs-text-3)" }} />
                      <span style={{ color: "var(--rs-text)" }}>น้ำ:</span>
                      <span className="tabular-nums">
                        เลขก่อน <b style={{ color: "var(--rs-text)" }}>{meterReadings.water.prev.toLocaleString()}</b> →{" "}
                        เลขหลัง <b style={{ color: "var(--rs-text)" }}>{meterReadings.water.curr.toLocaleString()}</b> ={" "}
                        ใช้ <b style={{ color: "var(--rs-text)" }}>{meterReadings.water.usage.toLocaleString()}</b> หน่วย
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* totals */}
            <div className="mt-4 pt-3 border-t" style={{ borderColor: "var(--rs-border)" }}>
              <div className="ml-auto max-w-xs">
                <TotalRow label="ยอดก่อนภาษี" value={formatBaht(subtotal)} />
                {discountTotal > 0 && <TotalRow label="ส่วนลด" value={`− ${formatBaht(discountTotal)}`} tone="ok" />}
                {vat > 0 && <TotalRow label="ภาษีมูลค่าเพิ่ม (VAT)" value={formatBaht(vat)} />}
                <div className="border-t my-1.5" style={{ borderColor: "var(--rs-border)" }} />
                <TotalRow label="ยอดรวมทั้งสิ้น" value={formatBaht(total)} strong />
                <TotalRow label="ชำระแล้ว" value={formatBaht(paid)} />
                <TotalRow label="คงเหลือ" value={formatBaht(remaining)} strong tone={remaining > 0 ? "danger" : "ok"} />
              </div>
            </div>

            {/* payment — ช่องทางชำระเงิน (โอน/พร้อมเพย์) ให้ผู้เช่าจ่ายง่าย */}
            {bank && (
              <div
                className="mt-5 rounded-xl px-4 py-3.5"
                style={{ background: "var(--rs-bg-2)", border: "1px solid var(--rs-border)" }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <Landmark className="h-4 w-4" style={{ color: "var(--rs-brand)" }} />
                  <span className="text-[13.5px] font-bold" style={{ color: "var(--rs-text)" }}>
                    ช่องทางชำระเงิน
                  </span>
                </div>
                <div className="space-y-1 text-[13px]" style={{ color: "var(--rs-text)" }}>
                  {bank.bankName && (
                    <div className="flex justify-between gap-3">
                      <span style={{ color: "var(--rs-text-2)" }}>ธนาคาร</span>
                      <b className="text-right">{bank.bankName}</b>
                    </div>
                  )}
                  {bank.bankAccountNo && (
                    <div className="flex justify-between gap-3">
                      <span style={{ color: "var(--rs-text-2)" }}>เลขบัญชี</span>
                      <b className="text-right tabular-nums select-all">{bank.bankAccountNo}</b>
                    </div>
                  )}
                  {bank.bankAccountHolder && (
                    <div className="flex justify-between gap-3">
                      <span style={{ color: "var(--rs-text-2)" }}>ชื่อบัญชี</span>
                      <b className="text-right">{bank.bankAccountHolder}</b>
                    </div>
                  )}
                  {bank.promptpayId && (
                    <div className="flex justify-between gap-3">
                      <span style={{ color: "var(--rs-text-2)" }}>พร้อมเพย์</span>
                      <b className="text-right tabular-nums select-all">{bank.promptpayId}</b>
                    </div>
                  )}
                </div>
                {bank.paymentNote && (
                  <div className="text-[12px] mt-2 pt-2 border-t" style={{ color: "var(--rs-text-2)", borderColor: "var(--rs-border)" }}>
                    {bank.paymentNote}
                  </div>
                )}
              </div>
            )}
           </div>
          </RsCard>

          {/* payment history */}
          <RsCard className="p-5 print:hidden">
            <h2 className="font-bold mb-3" style={{ color: "var(--rs-text)" }}>
              ประวัติการชำระเงิน
            </h2>
            {payments.length === 0 ? (
              <p className="text-[13px]" style={{ color: "var(--rs-text-3)" }}>
                ยังไม่มีการชำระเงิน
              </p>
            ) : (
              <div className="space-y-1.5">
                {payments.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between py-1.5 border-b last:border-0"
                    style={{ borderColor: "var(--rs-border)" }}
                  >
                    <div>
                      <div className="text-[13.5px] font-medium" style={{ color: "var(--rs-text)" }}>
                        {thaiDateLong(p.paidOn)}
                        <span className="ml-2 text-[12px] font-normal" style={{ color: "var(--rs-text-3)" }}>
                          {PAYMENT_METHODS[p.method] ?? p.method}
                          {p.reference ? ` · ${p.reference}` : ""}
                        </span>
                      </div>
                      {p.slipUrl ? (
                        <a href={p.slipUrl} target="_blank" rel="noreferrer" className="text-[12px]" style={{ color: "var(--rs-brand)" }}>
                          ดูสลิป
                        </a>
                      ) : null}
                    </div>
                    <div className="text-[13.5px] font-semibold tabular-nums" style={{ color: "var(--rs-ok)" }}>
                      {formatBaht(toNum(p.amountThb))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </RsCard>

          {/* discounts */}
          <RsCard className="p-5 print:hidden">
            <h2 className="font-bold mb-3" style={{ color: "var(--rs-text)" }}>
              ส่วนลด
            </h2>
            {discounts.length === 0 ? (
              <p className="text-[13px]" style={{ color: "var(--rs-text-3)" }}>
                ยังไม่มีคำขอส่วนลด
              </p>
            ) : (
              <div className="space-y-2">
                {discounts.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-start justify-between gap-3 py-2 border-b last:border-0"
                    style={{ borderColor: "var(--rs-border)" }}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-[13.5px] font-medium" style={{ color: "var(--rs-text)" }}>
                          {d.kind === "percent" ? `${toNum(d.value)}%` : formatBaht(toNum(d.value))}
                          <span className="ml-1.5 text-[12.5px] font-normal" style={{ color: "var(--rs-text-2)" }}>
                            (− {formatBaht(toNum(d.computedAmount))})
                          </span>
                        </span>
                        <RsBadge kind="discount" status={d.status} />
                      </div>
                      {d.reason ? (
                        <div className="text-[12.5px] mt-0.5" style={{ color: "var(--rs-text-3)" }}>
                          {d.reason}
                        </div>
                      ) : null}
                      {d.decisionNote ? (
                        <div className="text-[12px] mt-0.5" style={{ color: "var(--rs-text-3)" }}>
                          หมายเหตุการตัดสิน: {d.decisionNote}
                        </div>
                      ) : null}
                    </div>
                    {d.status === "pending" && isAdmin ? (
                      <DiscountDecisionButtons discountId={d.id} />
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </RsCard>
        </div>

        {/* ───── actions ───── */}
        <div className="space-y-4 print:hidden">
          <RsCard className="p-5 space-y-2">
            {canEdit && <RecordPaymentButton billId={bill.id} remaining={remaining} />}
            {canEdit && <RequestDiscountButton billId={bill.id} />}
            {bill.status !== "void" && (
              <SendBillButton
                billId={bill.id}
                initialSentAt={bill.sentAt ? bill.sentAt.toISOString() : null}
                initialUrl={bill.publicToken ? `${getBaseUrl()}/rentspace/bill/${bill.publicToken}` : null}
              />
            )}
            <PrintBillButton />
            {/* #5 ยกเลิกบิลแบบขออนุมัติ (maker→checker) */}
            {bill.status !== "void" && bill.voidStatus !== "pending" && (
              <RequestVoidButton billId={bill.id} />
            )}
            {bill.status !== "void" && bill.voidStatus === "pending" && isAdmin && (
              <VoidDecisionButtons billId={bill.id} />
            )}

            {/* แก้ไข / ลบบิลโดยตรง (super_admin เสมอ · คนอื่นเมื่อเปิดสิทธิ์ในหน้าตั้งค่า) */}
            {(canEditBill || canDeleteBill) && (
              <div className="pt-2 mt-1 border-t space-y-2" style={{ borderColor: "var(--rs-border)" }}>
                <div className="text-[11.5px] font-semibold" style={{ color: "var(--rs-pending)" }}>
                  ⚠️ จัดการบิลโดยตรง — มีบันทึกประวัติทุกครั้ง
                </div>
                {canEditBill && bill.status !== "void" && (
                  <EditBillButton
                    billId={bill.id}
                    vatPercent={toNum(bill.contract?.vatPercent)}
                    items={items.map((it) => ({
                      kind: it.kind,
                      label: it.label,
                      amount: toNum(it.amount),
                      vatable: it.vatable,
                    }))}
                  />
                )}
                {canDeleteBill && (
                  <DeleteBillButton billId={bill.id} billNo={bill.billNo} hasPayments={payments.length > 0} />
                )}
              </div>
            )}
          </RsCard>

          {/* #5 บันทึก/สถานะการขอยกเลิกบิล (log) */}
          {bill.voidStatus && bill.voidStatus !== "none" && (
            <RsCard className="p-5">
              <h2 className="font-bold mb-2" style={{ color: "var(--rs-text)" }}>
                การยกเลิกบิล
              </h2>
              <div className="space-y-1.5 text-[13px]">
                <div className="flex items-center gap-2">
                  <span style={{ color: "var(--rs-text-2)" }}>สถานะ:</span>
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
                    style={{
                      background:
                        bill.voidStatus === "approved"
                          ? "var(--rs-danger-soft)"
                          : bill.voidStatus === "rejected"
                            ? "var(--rs-bg-3)"
                            : "var(--rs-pending-soft)",
                      color:
                        bill.voidStatus === "approved"
                          ? "var(--rs-danger)"
                          : bill.voidStatus === "rejected"
                            ? "var(--rs-text-3)"
                            : "var(--rs-pending)",
                    }}
                  >
                    {bill.voidStatus === "pending"
                      ? "รออนุมัติยกเลิก"
                      : bill.voidStatus === "approved"
                        ? "ยกเลิกแล้ว (อนุมัติ)"
                        : "ปฏิเสธคำขอยกเลิก"}
                  </span>
                </div>
                {bill.voidReason && (
                  <div style={{ color: "var(--rs-text-2)" }}>
                    เหตุผล: <span style={{ color: "var(--rs-text)" }}>{bill.voidReason}</span>
                  </div>
                )}
                {bill.voidRequestedAt && (
                  <div style={{ color: "var(--rs-text-3)" }}>
                    ขอเมื่อ {thaiDateLong(bill.voidRequestedAt)}
                  </div>
                )}
                {bill.voidDecidedAt && (
                  <div style={{ color: "var(--rs-text-3)" }}>
                    ตัดสินเมื่อ {thaiDateLong(bill.voidDecidedAt)}
                    {bill.voidDecisionNote ? ` · ${bill.voidDecisionNote}` : ""}
                  </div>
                )}
              </div>
            </RsCard>
          )}
        </div>
      </div>

      <style>{`
        /* paid / unpaid / void stamp */
        #rs-bill { position: relative; }
        .rs-bill-stamp {
          position: absolute;
          top: 18px;
          right: 18px;
          transform: rotate(-12deg);
          padding: 4px 14px;
          border: 2.5px solid currentColor;
          border-radius: 8px;
          font-size: 15px;
          font-weight: 800;
          letter-spacing: 1px;
          opacity: .85;
          pointer-events: none;
        }
        .rs-bill-stamp[data-state="paid"] { color: var(--rs-ok); }
        .rs-bill-stamp[data-state="unpaid"] { color: var(--rs-danger); }
        .rs-bill-stamp[data-state="void"] { color: var(--rs-text-3); }

        @media print {
          @page { size: A4; margin: 14mm; }
          body { background: #fff; }
          body * { visibility: hidden; }
          #rs-bill, #rs-bill * { visibility: visible; }
          #rs-bill {
            position: absolute;
            inset: 0;
            box-shadow: none !important;
            border: none !important;
          }
          .rs-bill-stamp { top: 0; right: 0; }
        }
      `}</style>
    </RsPage>
  );
}
