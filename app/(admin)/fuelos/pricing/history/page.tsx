import Link from "next/link";
import { requireUser } from "@/lib/fuelos/auth";
import { getDepotPriceHistory } from "@/lib/fuelos/pricing-data";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { BackButton } from "@/components/fuelos/ui/back-button";
import { bkkDate } from "@/lib/fuelos/utils/format";
import { cn } from "@/lib/fuelos/utils/cn";
import { Warehouse } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function PricingHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ depot?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const { depots, depot, products, rows } = await getDepotPriceHistory(user.orgId, sp.depot);

  return (
    <div>
      <BackButton fallbackHref="/fuelos/pricing" className="mb-3" />
      <PageHeader
        title="ต้นทุนคลังย้อนหลัง"
        subtitle="ต้นทุนน้ำมันต่อลิตรที่ตั้งไว้แต่ละวัน (เก็บ 90 วันล่าสุด)"
      />

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-10 text-center">
          <Warehouse className="size-10 mx-auto text-zinc-300" />
          <p className="mt-3 font-semibold">ยังไม่มีประวัติต้นทุน</p>
          <p className="text-sm text-zinc-500 mt-1.5 max-w-md mx-auto">
            ทุกครั้งที่ตั้งราคาต้นทุนคลังในหน้า “ราคาน้ำมัน” ระบบจะเก็บไว้ให้ดูย้อนหลังที่นี่อัตโนมัติ
          </p>
          <Link
            href="/fuelos/pricing"
            className="mt-4 inline-flex items-center h-10 px-4 rounded-xl bg-brand-600 text-white text-sm font-medium"
          >
            ไปตั้งราคาต้นทุน
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {depots.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {depots.map((d) => (
                <Link
                  key={d}
                  href={`/fuelos/pricing/history?depot=${encodeURIComponent(d)}`}
                  className={cn(
                    "h-8 px-3 inline-flex items-center rounded-full text-sm font-medium transition-colors",
                    d === depot
                      ? "bg-brand-600 text-white"
                      : "bg-surface-2 text-zinc-600 hover:bg-surface-3",
                  )}
                >
                  {d}
                </Link>
              ))}
            </div>
          )}

          {/* ตาราง: แถว=วัน · คอลัมน์=ผลิตภัณฑ์ */}
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left font-semibold px-3 py-2.5 sticky left-0 bg-surface z-10 whitespace-nowrap">
                    วันที่
                  </th>
                  {products.map((p) => (
                    <th key={p.key} className="text-right font-semibold px-3 py-2.5 whitespace-nowrap">
                      {p.label}
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
                        key={p.key}
                        className="text-right px-3 py-2 tabular-nums font-[family-name:var(--font-plex-mono)] whitespace-nowrap"
                      >
                        {r.costs[p.key] != null ? (
                          r.costs[p.key].toFixed(2)
                        ) : (
                          <span className="text-zinc-300">–</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-zinc-400">หน่วย: ฿/ลิตร (ต้นทุนคลัง ไม่รวมค่าขนส่ง/กำไรโซน)</p>
        </div>
      )}
    </div>
  );
}
