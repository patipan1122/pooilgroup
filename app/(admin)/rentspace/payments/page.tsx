import Link from "next/link";
import { Receipt, Banknote } from "lucide-react";
import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { RsPage, RsHeader, RsKpi, RsBadge, RsEmpty, RsCard, RsBackLink } from "@/components/rentspace/ui";
import {
  formatBaht,
  thaiDateLong,
  toNum,
  tenantDisplayName,
  periodLabel,
  currentPeriod,
  PAYMENT_METHODS,
} from "@/lib/rentspace/format";
import { listPayments, pendingDiscounts } from "@/lib/rentspace/data";
import { DiscountDecisionButtons } from "../bills/[id]/_components/bill-detail-actions";

export const dynamic = "force-dynamic";

function isThisPeriod(d: Date): boolean {
  const period = currentPeriod();
  const bkk = new Date(new Date(d).toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
  const p = `${bkk.getFullYear()}-${String(bkk.getMonth() + 1).padStart(2, "0")}`;
  return p === period;
}

export default async function PaymentsPage() {
  const session = await requireSession();
  const orgId = session.user.org_id;
  const isAdmin = isAdminTier(session.user.role);

  const [payments, pending] = await Promise.all([listPayments(orgId), pendingDiscounts(orgId)]);

  const collectedThisMonth = payments
    .filter((p) => isThisPeriod(p.paidOn))
    .reduce((s, p) => s + toNum(p.amountThb), 0);

  return (
    <RsPage>
      <RsBackLink href="/rentspace" label="กลับหน้าหลัก" />
      <RsHeader title="การชำระเงิน" subtitle="รับชำระ & อนุมัติส่วนลด" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <RsKpi
          label={`รับชำระเดือนนี้ (${periodLabel(currentPeriod())})`}
          value={formatBaht(collectedThisMonth)}
          tone="ok"
        />
        <RsKpi label="รออนุมัติส่วนลด" value={pending.length} tone={pending.length ? "pending" : undefined} hint="คำขอ" />
        <RsKpi label="รายการชำระทั้งหมด" value={payments.length} hint="รายการ" />
      </div>

      {/* ───── pending discounts ───── */}
      <RsCard className="p-5">
        <h2 className="font-bold mb-3" style={{ color: "var(--rs-text)" }}>
          รออนุมัติส่วนลด
        </h2>
        {pending.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--rs-text-3)" }}>
            ไม่มีคำขอส่วนลดที่รออนุมัติ
          </p>
        ) : (
          <div className="space-y-2">
            {pending.map((d) => (
              <div
                key={d.id}
                className="flex items-start justify-between gap-3 py-2.5 border-b last:border-0"
                style={{ borderColor: "var(--rs-border)" }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/rentspace/bills/${d.billId}`}
                      className="text-[13.5px] font-semibold inline-flex items-center gap-1.5"
                      style={{ color: "var(--rs-brand)" }}
                    >
                      <Receipt className="h-3.5 w-3.5" /> {d.bill.billNo}
                    </Link>
                    <span className="text-[13px]" style={{ color: "var(--rs-text)" }}>
                      {d.bill.unit.code} · {tenantDisplayName(d.bill.tenant)}
                    </span>
                    <RsBadge kind="discount" status={d.status} />
                  </div>
                  <div className="text-[13px] mt-0.5" style={{ color: "var(--rs-text-2)" }}>
                    {d.kind === "percent" ? `${toNum(d.value)}%` : formatBaht(toNum(d.value))}
                    <span className="ml-1.5" style={{ color: "var(--rs-text-3)" }}>
                      (− {formatBaht(toNum(d.computedAmount))})
                    </span>
                    {d.reason ? ` · ${d.reason}` : ""}
                  </div>
                </div>
                {isAdmin ? (
                  <DiscountDecisionButtons discountId={d.id} />
                ) : (
                  <span className="text-[12px] shrink-0" style={{ color: "var(--rs-text-3)" }}>
                    เฉพาะผู้ดูแลอนุมัติได้
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </RsCard>

      {/* ───── payment history ───── */}
      <RsCard className="overflow-hidden">
        <div className="px-5 pt-4 pb-2 flex items-center gap-2">
          <Banknote className="h-4 w-4" style={{ color: "var(--rs-text-2)" }} />
          <h2 className="font-bold" style={{ color: "var(--rs-text)" }}>
            ประวัติการชำระเงิน
          </h2>
        </div>
        {payments.length === 0 ? (
          <RsEmpty icon="💸" title="ยังไม่มีการชำระเงิน" hint="เมื่อบันทึกรับชำระจากหน้าบิล รายการจะมาแสดงที่นี่" />
        ) : (
          <div className="overflow-x-auto">
            <table className="rs-table w-full text-sm">
              <thead>
                <tr style={{ color: "var(--rs-text-2)" }} className="text-left text-[12.5px]">
                  <th className="px-4 py-2.5 font-semibold">วันที่</th>
                  <th className="px-4 py-2.5 font-semibold">เลขที่บิล</th>
                  <th className="px-4 py-2.5 font-semibold">ห้อง / ผู้เช่า</th>
                  <th className="px-4 py-2.5 font-semibold">วิธีชำระ</th>
                  <th className="px-4 py-2.5 font-semibold text-right">จำนวนเงิน</th>
                  <th className="px-4 py-2.5 font-semibold text-center">สลิป</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr
                    key={p.id}
                    className="border-t hover:bg-[var(--rs-bg-2)] transition"
                    style={{ borderColor: "var(--rs-border)" }}
                  >
                    <td className="px-4 py-3 text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
                      {thaiDateLong(p.paidOn)}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/rentspace/bills/${p.billId}`}
                        className="font-semibold inline-flex items-center gap-1.5"
                        style={{ color: "var(--rs-brand)" }}
                      >
                        <Receipt className="h-3.5 w-3.5" /> {p.bill.billNo}
                      </Link>
                    </td>
                    <td className="px-4 py-3" style={{ color: "var(--rs-text)" }}>
                      {p.bill.unit.code}
                      <span style={{ color: "var(--rs-text-3)" }}>{" · "}{tenantDisplayName(p.bill.tenant)}</span>
                    </td>
                    <td className="px-4 py-3 text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
                      {PAYMENT_METHODS[p.method] ?? p.method}
                      {p.reference ? <span style={{ color: "var(--rs-text-3)" }}> · {p.reference}</span> : null}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold" style={{ color: "var(--rs-ok)" }}>
                      {formatBaht(toNum(p.amountThb))}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {p.slipUrl ? (
                        <a href={p.slipUrl} target="_blank" rel="noreferrer" className="text-[12.5px]" style={{ color: "var(--rs-brand)" }}>
                          ดู
                        </a>
                      ) : (
                        <span style={{ color: "var(--rs-text-3)" }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </RsCard>
    </RsPage>
  );
}
