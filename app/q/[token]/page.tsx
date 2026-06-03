import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getQuoteByToken } from "@/lib/fuelos/quotes-data";
import { formatBaht, formatNumber, thaiDateLong } from "@/lib/fuelos/utils/format";
import { PRODUCT_LABELS } from "@/lib/fuelos/pricing";
import { Fuel, Phone, CalendarClock, ShieldCheck } from "lucide-react";

export const metadata: Metadata = {
  title: "ใบเสนอราคา · PO Oil",
  robots: { index: false, follow: false }, // public-by-token, ไม่ต้องให้ search index
};

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const q = await getQuoteByToken(token);
  if (!q) notFound();

  const subtotal = Number(q.subtotal);
  const customerName = q.customer?.legalName ?? q.customer?.name ?? q.prospectName ?? "ลูกค้า";
  const orgName = q.org?.name ?? "PO Oil";

  return (
    <main className="min-h-dvh bg-surface-2 py-6 px-4 sm:py-10">
      <div className="mx-auto max-w-2xl">
        {/* แบรนด์การ์ด */}
        <div className="rounded-3xl border border-border bg-surface shadow-md overflow-hidden">
          {/* header */}
          <div className="bg-brand-600 text-white p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <div className="size-12 rounded-2xl bg-white/15 grid place-items-center">
                <Fuel className="size-6" />
              </div>
              <div>
                <div className="text-lg font-bold tracking-tight">{orgName}</div>
                <div className="text-xs text-white/70">ระบบขายส่งน้ำมัน</div>
              </div>
            </div>
            <div className="mt-6">
              <div className="text-xs text-white/70">ใบเสนอราคา</div>
              <div className="text-2xl font-bold font-[family-name:var(--font-plex-mono)]">{q.quoteNo}</div>
            </div>
          </div>

          {/* meta */}
          <div className="p-6 sm:p-8 space-y-6">
            <div className="grid sm:grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[11px] text-zinc-400">เรียน</div>
                <div className="font-semibold">{customerName}</div>
              </div>
              <div className="sm:text-right">
                <div className="text-[11px] text-zinc-400">วันที่</div>
                <div className="font-medium">{thaiDateLong(q.quoteDate)}</div>
              </div>
            </div>

            {q.validUntil && (
              <div className="flex items-center gap-2 text-sm text-zinc-600 rounded-xl bg-surface-2 px-3 py-2.5">
                <CalendarClock className="size-4 text-brand-600 shrink-0" />
                ยืนราคาถึงวันที่ <b className="text-zinc-800">{thaiDateLong(q.validUntil)}</b>
              </div>
            )}

            {/* รายการ */}
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[420px]">
                <thead>
                  <tr className="text-left text-[11px] text-zinc-400 border-b border-border">
                    <th className="font-medium pb-2">รายการ</th>
                    <th className="font-medium pb-2 text-right">จำนวน (ล.)</th>
                    <th className="font-medium pb-2 text-right">ราคา/ล.</th>
                    <th className="font-medium pb-2 text-right">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  {q.items.map((it) => (
                    <tr key={it.id} className="border-b border-border/60 last:border-0">
                      <td className="py-3 font-medium">{PRODUCT_LABELS[it.productType]}</td>
                      <td className="py-3 text-right tabular-nums">{formatNumber(Number(it.qtyLiters))}</td>
                      <td className="py-3 text-right tabular-nums font-[family-name:var(--font-plex-mono)]">
                        {formatNumber(Number(it.finalPrice))}
                      </td>
                      <td className="py-3 text-right tabular-nums font-medium">{formatBaht(Number(it.lineTotal))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* รวม */}
            <div className="rounded-2xl bg-brand-50 border border-brand-100 p-4 flex items-center justify-between">
              <span className="text-sm font-medium text-brand-800">ยอดรวมทั้งสิ้น</span>
              <span className="text-2xl font-bold tabular-nums text-brand-700 font-[family-name:var(--font-plex-mono)]">
                {formatBaht(subtotal)}
              </span>
            </div>

            {q.notes && (
              <div className="text-sm text-zinc-600">
                <div className="text-[11px] text-zinc-400 mb-1">หมายเหตุ</div>
                {q.notes}
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-zinc-400 pt-2 border-t border-border">
              <ShieldCheck className="size-4 text-leaf-600 shrink-0" />
              ราคานี้รวมค่าจัดส่งตามเงื่อนไข · สอบถามเพิ่มเติมติดต่อฝ่ายขาย
            </div>
          </div>
        </div>

        {/* footer */}
        <div className="text-center mt-5 text-xs text-zinc-400">
          <div className="inline-flex items-center gap-1.5">
            <Phone className="size-3.5" /> ออกโดย {orgName}
          </div>
          <div className="mt-1">ใบเสนอราคานี้สร้างจากระบบ · ราคาอาจเปลี่ยนแปลงตามราคาตลาด</div>
        </div>
      </div>
    </main>
  );
}
