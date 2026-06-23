import Link from "next/link";
import { requireUser } from "@/lib/fuelos/auth";
import { getPumpPriceHistory } from "@/lib/fuelos/pump-price-history";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { BackButton } from "@/components/fuelos/ui/back-button";
import { bkkDate } from "@/lib/fuelos/utils/format";
import { cn } from "@/lib/fuelos/utils/cn";
import { Fuel } from "lucide-react";
import { SnapshotButton } from "./snapshot-button";

export const dynamic = "force-dynamic";

export default async function PumpPriceHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ station?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const { stations, station, products, rows } = await getPumpPriceHistory(sp.station);

  return (
    <div>
      <BackButton fallbackHref="/fuelos/pump-price" className="mb-3" />
      <PageHeader
        title="ราคาหน้าปั๊มย้อนหลัง"
        subtitle="ราคาขายปลีกอ้างอิงรายวัน · ระบบเก็บอัตโนมัติทุกวัน (เก็บ 60 วันล่าสุด)"
        actions={<SnapshotButton />}
      />

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-10 text-center">
          <Fuel className="size-10 mx-auto text-zinc-300" />
          <p className="mt-3 font-semibold">ยังไม่มีข้อมูลย้อนหลัง</p>
          <p className="text-sm text-zinc-500 mt-1.5 max-w-md mx-auto">
            ระบบจะเริ่มเก็บราคาอัตโนมัติทุกเช้า · กดปุ่ม “บันทึกราคาวันนี้” ด้านบนเพื่อเริ่มเก็บวันแรกเลยก็ได้
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {stations.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {stations.map((s) => (
                <Link
                  key={s.key}
                  href={`/fuelos/pump-price/history?station=${s.key}`}
                  className={cn(
                    "h-8 px-3 inline-flex items-center rounded-full text-sm font-medium transition-colors",
                    s.key === station
                      ? "bg-brand-600 text-white"
                      : "bg-surface-2 text-zinc-600 hover:bg-surface-3",
                  )}
                >
                  {s.label}
                </Link>
              ))}
            </div>
          )}

          {/* ตาราง: แถว=วัน · คอลัมน์=ผลิตภัณฑ์ (เลื่อนแนวนอนบนมือถือ) */}
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left font-semibold px-3 py-2.5 sticky left-0 bg-surface z-10 whitespace-nowrap">
                    วันที่
                  </th>
                  {products.map((p) => (
                    <th key={p} className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b border-border/60 last:border-0 hover:bg-surface-2/50">
                    <td className="px-3 py-2 sticky left-0 bg-surface z-10 whitespace-nowrap font-medium">
                      {bkkDate(r.date)}
                    </td>
                    {products.map((p) => (
                      <td
                        key={p}
                        className="text-right px-3 py-2 tabular-nums font-[family-name:var(--font-plex-mono)] whitespace-nowrap"
                      >
                        {r.prices[p] != null ? r.prices[p].toFixed(2) : <span className="text-zinc-300">–</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-zinc-400">หน่วย: ฿/ลิตร · ข้อมูลจาก thai-oil-api (ราคาขายปลีก กทม. และปริมณฑล)</p>
        </div>
      )}
    </div>
  );
}
