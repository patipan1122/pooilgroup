import Link from "next/link";
import { requireUser } from "@/lib/fuelos/auth";
import { getInvoiceDetail, type PaymentState } from "@/lib/fuelos/sales-data";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { StatusPill } from "@/components/fuelos/ui/status-pill";
import { formatBaht, formatNumber, bkkDate } from "@/lib/fuelos/utils/format";
import { cn } from "@/lib/fuelos/utils/cn";
import { ArrowLeft, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";
export const maxDuration = 30; // เผื่อเวลาเรียก iv/read ครั้งแรก

function stateLabel(s: PaymentState): { tone: "success" | "warning" | "neutral"; text: string } {
  if (s === "PAID") return { tone: "success", text: "จ่ายแล้ว" };
  if (s === "PARTIAL") return { tone: "warning", text: "จ่ายบางส่วน" };
  return { tone: "neutral", text: "ค้างจ่าย" };
}

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const inv = await getInvoiceDetail(user.orgId, id);

  if (!inv) {
    return (
      <div>
        <Link href="/fuelos/sales" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-brand-600 mb-4">
          <ArrowLeft className="size-4" /> กลับยอดขาย/ลูกหนี้
        </Link>
        <div className="rounded-xl border border-border bg-surface px-6 py-10 text-center text-sm text-zinc-500">ไม่พบบิลนี้</div>
      </div>
    );
  }

  const st = stateLabel(inv.paymentState);
  const backKey = inv.contactId ?? `n:${inv.customerName}`;

  return (
    <div>
      <Link href={`/fuelos/sales/c/${encodeURIComponent(backKey)}`} className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-brand-600 mb-3">
        <ArrowLeft className="size-4" /> กลับหน้าลูกค้า
      </Link>

      <PageHeader
        title={inv.docNo}
        subtitle={[inv.customerOrg || inv.customerName, `ออกบิล ${bkkDate(inv.issueDate)}`].filter(Boolean).join(" · ")}
        actions={
          <div className="flex items-center gap-1.5">
            <StatusPill tone={st.tone}>{st.text}</StatusPill>
            {inv.isOverdue && <StatusPill tone="danger">เกิน {inv.overdueDays} วัน</StatusPill>}
          </div>
        }
      />

      {/* ข้อมูลบิล */}
      <div className="grid sm:grid-cols-2 gap-3 mb-5">
        <div className="rounded-xl border border-border bg-surface p-4 text-sm space-y-1.5">
          <Row label="ลูกค้า" value={inv.customerOrg || inv.customerName} />
          {inv.customerTaxId && <Row label="เลขภาษี" value={inv.customerTaxId} />}
          {inv.salesman && <Row label="พนักงานขาย" value={inv.salesman} />}
          <Row label="ออกบิล" value={bkkDate(inv.issueDate)} />
          <Row label="ครบกำหนด" value={inv.dueDate ? bkkDate(inv.dueDate) : "—"} />
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 text-sm space-y-1.5">
          <Row label="มูลค่าก่อน VAT" value={formatBaht(inv.netTotal)} />
          <Row label="VAT" value={formatBaht(inv.vatTotal)} />
          <Row label="ยอดรวม" value={formatBaht(inv.grandTotal)} bold />
          <Row label="จ่ายแล้ว" value={formatBaht(inv.paidAmount)} valueClass="text-emerald-600" />
          <Row label="จ่ายวันที่" value={inv.paidDate ? bkkDate(inv.paidDate) : "—"} />
          <Row label="คงค้าง" value={inv.outstanding > 0 ? formatBaht(inv.outstanding) : "—"} valueClass={inv.outstanding > 0 ? "text-amber-600 font-medium" : "text-zinc-400"} />
        </div>
      </div>

      {/* รายการสินค้า */}
      <h2 className="text-sm font-semibold text-zinc-700 mb-2">รายการสินค้า</h2>
      {inv.items.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-6 text-center text-sm text-zinc-500 inline-flex items-center justify-center gap-2 w-full">
          {inv.itemsAvailable ? "บิลนี้ไม่มีรายการสินค้า" : (<><AlertTriangle className="size-4 text-amber-500" /> ดึงรายการสินค้าไม่สำเร็จ ลองรีเฟรชอีกครั้ง</>)}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500 border-b border-border">
                <th className="px-4 py-2.5 font-medium">สินค้า</th>
                <th className="px-4 py-2.5 font-medium text-right">ลิตร</th>
                <th className="px-4 py-2.5 font-medium text-right">ราคา/หน่วย</th>
                <th className="px-4 py-2.5 font-medium text-right">รวม</th>
              </tr>
            </thead>
            <tbody>
              {inv.items.map((it, i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-zinc-800">{it.name}</div>
                    {it.code && <div className="text-xs text-zinc-400">{it.code}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatNumber(it.qty)}{it.unit ? ` ${it.unit}` : ""}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatBaht(it.price)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium">{formatBaht(it.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, bold, valueClass }: { label: string; value: string; bold?: boolean; valueClass?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-zinc-500">{label}</span>
      <span className={cn("tabular-nums text-right", bold && "font-semibold", valueClass)}>{value}</span>
    </div>
  );
}
