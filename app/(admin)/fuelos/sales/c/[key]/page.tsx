import Link from "next/link";
import { requireUser } from "@/lib/fuelos/auth";
import { getCustomerDetail, type PaymentState } from "@/lib/fuelos/sales-data";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { KpiTile } from "@/components/fuelos/ui/kpi-tile";
import { StatusPill } from "@/components/fuelos/ui/status-pill";
import { formatBaht, formatNumber, bkkDate } from "@/lib/fuelos/utils/format";
import { cn } from "@/lib/fuelos/utils/cn";
import { ArrowLeft, Receipt, Wallet, Clock, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

function stateLabel(s: PaymentState): { tone: "success" | "warning" | "neutral"; text: string } {
  if (s === "PAID") return { tone: "success", text: "จ่ายแล้ว" };
  if (s === "PARTIAL") return { tone: "warning", text: "จ่ายบางส่วน" };
  return { tone: "neutral", text: "ค้างจ่าย" };
}

export default async function CustomerSalesPage({ params }: { params: Promise<{ key: string }> }) {
  const user = await requireUser();
  const { key } = await params;
  const cust = await getCustomerDetail(user.orgId, decodeURIComponent(key));

  if (!cust) {
    return (
      <div>
        <Link href="/fuelos/sales" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-brand-600 mb-4">
          <ArrowLeft className="size-4" /> กลับยอดขาย/ลูกหนี้
        </Link>
        <div className="rounded-xl border border-border bg-surface px-6 py-10 text-center text-sm text-zinc-500">ไม่พบข้อมูลลูกค้ารายนี้</div>
      </div>
    );
  }

  return (
    <div>
      <Link href="/fuelos/sales" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-brand-600 mb-3">
        <ArrowLeft className="size-4" /> กลับยอดขาย/ลูกหนี้
      </Link>

      <PageHeader
        title={cust.org || cust.name}
        subtitle={[cust.org && cust.name !== cust.org ? cust.name : null, cust.taxId ? `เลขภาษี ${cust.taxId}` : null, `${formatNumber(cust.invoiceCount)} ใบ`].filter(Boolean).join(" · ")}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <KpiTile icon={<Receipt className="size-4" />} label="ยอดซื้อรวม" value={formatBaht(cust.totalSales)} accent="brand" isMoney />
        <KpiTile icon={<Wallet className="size-4" />} label="จ่ายแล้ว" value={formatBaht(cust.paid)} accent="success" isMoney />
        <KpiTile icon={<Clock className="size-4" />} label="ค้างชำระ" value={formatBaht(cust.outstanding)} accent="warning" isMoney />
        <KpiTile icon={<AlertTriangle className="size-4" />} label="เกินกำหนด" value={formatBaht(cust.overdue)} accent="danger" isMoney subDanger
          sub={cust.overdue > 0 ? "ต้องตามเก็บ" : "ไม่มีเกินกำหนด"} />
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 border-b border-border">
              <th className="px-4 py-2.5 font-medium">เลขที่</th>
              <th className="px-4 py-2.5 font-medium">ซื้อวันที่</th>
              <th className="px-4 py-2.5 font-medium">ครบกำหนด</th>
              <th className="px-4 py-2.5 font-medium text-right">ยอด</th>
              <th className="px-4 py-2.5 font-medium text-right">จ่ายแล้ว</th>
              <th className="px-4 py-2.5 font-medium">จ่ายวันที่</th>
              <th className="px-4 py-2.5 font-medium text-right">ค้าง</th>
              <th className="px-4 py-2.5 font-medium">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {cust.invoices.map((r) => {
              const st = stateLabel(r.paymentState);
              return (
                <tr key={r.id} className="border-b border-border/60 last:border-0 hover:bg-zinc-50/60">
                  <td className="px-4 py-2.5 font-medium text-zinc-700 whitespace-nowrap">{r.docNo}</td>
                  <td className="px-4 py-2.5 text-zinc-600 whitespace-nowrap">{bkkDate(r.issueDate)}</td>
                  <td className="px-4 py-2.5 text-zinc-500 whitespace-nowrap">{r.dueDate ? bkkDate(r.dueDate) : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatBaht(r.grandTotal)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-600">{r.paidAmount > 0 ? formatBaht(r.paidAmount) : "—"}</td>
                  <td className="px-4 py-2.5 text-zinc-500 whitespace-nowrap">{r.paidDate ? bkkDate(r.paidDate) : "—"}</td>
                  <td className={cn("px-4 py-2.5 text-right tabular-nums font-medium", r.outstanding > 0 ? "text-amber-600" : "text-zinc-300")}>{r.outstanding > 0 ? formatBaht(r.outstanding) : "—"}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <StatusPill tone={st.tone}>{st.text}</StatusPill>
                      {r.isOverdue && <StatusPill tone="danger">เกิน {r.overdueDays} วัน</StatusPill>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
