import { notFound } from "next/navigation";
import { Scissors } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier, isSuperAdmin } from "@/lib/auth/role-guards";
import { userIsModuleAdmin } from "@/lib/auth/module-access";
import { RsPage, RsHeader, RsBadge, RsCard, RsBackLink } from "@/components/rentspace/ui";
import {
  formatBaht,
  thaiDateLong,
  toNum,
  periodLabel,
  PAYMENT_METHODS,
} from "@/lib/rentspace/format";
import { getBill } from "@/lib/rentspace/data";
import { BillDocument } from "@/components/rentspace/bill-document";
import { loadBillMeterReadings, projectBankInfo } from "@/lib/rentspace/bill-extras";
import { getBaseUrl } from "@/lib/utils/base-url";
import {
  RecordPaymentButton,
  RequestDiscountButton,
  DiscountDecisionButtons,
  PrintBillButton,
  TaxInvoiceButton,
  SendBillButton,
  RequestVoidButton,
  VoidDecisionButtons,
  EditBillButton,
  DeleteBillButton,
  VoidPaymentButton,
} from "./_components/bill-detail-actions";

export const dynamic = "force-dynamic";

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
            <BillDocument bill={{ ...bill, meterReadings, bank }} />
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
                    <div className="flex items-center gap-2 shrink-0">
                      <div
                        className="text-[13.5px] font-semibold tabular-nums"
                        style={{
                          color:
                            p.status === "voided"
                              ? "var(--rs-text-3)"
                              : p.status === "pending"
                                ? "var(--rs-pending)"
                                : "var(--rs-ok)",
                          textDecoration: p.status === "voided" ? "line-through" : undefined,
                        }}
                      >
                        {formatBaht(toNum(p.amountThb))}
                      </div>
                      {p.status === "voided" ? (
                        <span className="text-[11.5px]" style={{ color: "var(--rs-text-3)" }}>
                          ถอนแล้ว
                        </span>
                      ) : p.status === "pending" ? (
                        <span className="text-[11.5px]" style={{ color: "var(--rs-pending)" }}>
                          รอตรวจสลิป
                        </span>
                      ) : bill.status !== "void" && p.status === "confirmed" ? (
                        // ถอนได้แม้บิลจ่ายครบแล้ว (paid) — เคสคีย์ยอดผิดจนบิลกลายเป็น paid ต้องถอนได้
                        // (void จะ decrement paidAmount + recompute → สถานะบิลปรับกลับเอง) · กันเฉพาะบิล void
                        <VoidPaymentButton paymentId={p.id} amount={toNum(p.amountThb)} />
                      ) : null}
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
            {bill.status !== "void" && (
              <TaxInvoiceButton billId={bill.id} status={bill.status} taxInvoiceNo={bill.taxInvoiceNo} />
            )}
            {/* แตกบิล — พิมพ์ "ใบวางบิลแยก" (ค่าเช่า / ค่าน้ำ-ไฟ) โดยบิลหลักไม่เปลี่ยน */}
            {bill.status !== "void" && (
              <a
                href={`/rentspace/bills/${bill.id}/split`}
                className="rs-btn rs-btn-ghost w-full justify-center"
              >
                <Scissors className="h-4 w-4" /> แตกบิล (พิมพ์ใบวางบิลแยก)
              </a>
            )}
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
