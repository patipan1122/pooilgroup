import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/fuelos/auth";
import { getQuote } from "@/lib/fuelos/quotes-data";
import { formatBaht, formatNumber, bkkDate, thaiDateLong } from "@/lib/fuelos/utils/format";
import { cn } from "@/lib/fuelos/utils/cn";
import { PRODUCT_LABELS } from "@/lib/fuelos/pricing";
import { QUOTE_STATUS } from "../quote-status";
import { QuoteActions } from "./quote-actions";
import { ArrowLeft, User, Phone, MapPin, Trophy } from "lucide-react";

export default async function QuoteDetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const q = await getQuote(user.orgId, id);
  if (!q) notFound();

  const s = QUOTE_STATUS[q.status];
  const subtotal = Number(q.subtotal);
  const name = q.customer?.name ?? q.prospectName ?? "—";
  const phone = q.customer?.phone ?? q.prospectPhone ?? null;
  const zone = q.customer?.zone ?? null;
  const canConvert = !!q.customerId && !q.resultOrderId;

  return (
    <div>
      <Link href="/quotes" className="inline-flex items-center gap-1 text-sm text-zinc-500 mb-3">
        <ArrowLeft className="size-4" /> ใบเสนอราคาทั้งหมด
      </Link>

      {/* header */}
      <div className="rounded-2xl border border-border bg-surface p-5 mb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold font-[family-name:var(--font-plex-mono)]">{q.quoteNo}</h1>
              <span className={cn("text-[11px] px-2 py-0.5 rounded-full", s.tone)}>{s.label}</span>
            </div>
            <div className="text-sm text-zinc-500 mt-1">
              ออกเมื่อ {bkkDate(q.quoteDate)} · โดย {q.sales?.name ?? "—"}
              {q.validUntil ? ` · ยืนราคาถึง ${bkkDate(q.validUntil)}` : ""}
            </div>
          </div>
        </div>

        <div className="mt-3 grid sm:grid-cols-2 gap-2 text-sm">
          <div className="flex items-center gap-2 text-zinc-600">
            <User className="size-4 text-zinc-400" />
            {q.customerId ? (
              <Link href={`/customers/${q.customerId}`} className="font-medium text-brand-700 hover:underline">
                {name}
              </Link>
            ) : (
              <span className="font-medium">{name} <span className="text-[10px] text-info">(ผู้สนใจใหม่)</span></span>
            )}
          </div>
          {phone && (
            <div className="flex items-center gap-2 text-zinc-600">
              <Phone className="size-4 text-zinc-400" /> {phone}
            </div>
          )}
          {zone && (
            <div className="flex items-center gap-2 text-zinc-600">
              <MapPin className="size-4 text-zinc-400" /> โซน {zone}
            </div>
          )}
        </div>

        {q.status === "LOST" && q.lostTo && (
          <div className="mt-3 rounded-xl bg-danger/5 border border-danger/20 p-3 text-sm flex items-center gap-2 text-zinc-700">
            <Trophy className="size-4 text-danger shrink-0" />
            แพ้ให้ <b>{q.lostTo}</b>
            {q.competitorPrice != null && (
              <span className="text-zinc-500">· ราคาคู่แข่ง {formatNumber(Number(q.competitorPrice))} ฿/ล.</span>
            )}
          </div>
        )}

        {q.resultOrderId && (
          <div className="mt-3">
            <Link
              href={`/orders/${q.resultOrderId}`}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-leaf-100 text-leaf-700 text-sm font-medium"
            >
              <Trophy className="size-4" /> ดูออเดอร์ที่เกิดจากใบนี้
            </Link>
          </div>
        )}
      </div>

      {/* items table */}
      <div className="rounded-2xl border border-border bg-surface p-4 mb-3 overflow-x-auto">
        <table className="w-full text-sm min-w-[520px]">
          <thead>
            <tr className="text-left text-[11px] text-zinc-400 border-b border-border">
              <th className="font-medium pb-2">สินค้า</th>
              <th className="font-medium pb-2 text-right">จำนวน (ล.)</th>
              <th className="font-medium pb-2 text-right">ราคา/ล.</th>
              <th className="font-medium pb-2 text-right">รวม</th>
            </tr>
          </thead>
          <tbody>
            {q.items.map((it) => (
              <tr key={it.id} className="border-b border-border/60 last:border-0">
                <td className="py-2.5 font-medium">{PRODUCT_LABELS[it.productType]}</td>
                <td className="py-2.5 text-right tabular-nums">{formatNumber(Number(it.qtyLiters))}</td>
                <td className="py-2.5 text-right tabular-nums font-[family-name:var(--font-plex-mono)]">
                  {formatNumber(Number(it.finalPrice))}
                </td>
                <td className="py-2.5 text-right tabular-nums font-medium">{formatBaht(Number(it.lineTotal))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="pt-3 text-right text-sm text-zinc-500">ยอดรวมทั้งสิ้น</td>
              <td className="pt-3 text-right text-lg font-bold tabular-nums font-[family-name:var(--font-plex-mono)]">
                {formatBaht(subtotal)}
              </td>
            </tr>
          </tfoot>
        </table>
        {q.notes && (
          <div className="mt-3 border-t border-border pt-3 text-sm text-zinc-600">
            <span className="text-[11px] text-zinc-400 block mb-0.5">หมายเหตุ</span>
            {q.notes}
          </div>
        )}
      </div>

      {/* actions (client) */}
      <QuoteActions
        quoteId={q.id}
        status={q.status}
        publicToken={q.publicToken}
        canConvert={canConvert}
        alreadyConverted={!!q.resultOrderId}
      />

      <p className="text-[11px] text-zinc-400 mt-4 text-center">
        ออกเมื่อ {thaiDateLong(q.quoteDate)} · PO Oil
      </p>
    </div>
  );
}
