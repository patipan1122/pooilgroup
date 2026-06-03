import Link from "next/link";
import { requireUser } from "@/lib/fuelos/auth";
import { listOrdersBoard } from "@/lib/fuelos/orders-data";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { formatBaht, formatNumber, bkkDate } from "@/lib/fuelos/utils/format";
import { cn } from "@/lib/fuelos/utils/cn";
import { Truck, CalendarClock } from "lucide-react";

// สีหัวคอลัมน์ตามสถานะ
const COL_ACCENT: Record<string, string> = {
  AWAITING_CONFIRM: "bg-zinc-400",
  DELIVERING: "bg-info",
  DELIVERED_UNPAID: "bg-warning",
  CLOSED: "bg-leaf-500",
};

export default async function OrdersPage() {
  const user = await requireUser();
  const { columns, total } = await listOrdersBoard(user.orgId);

  return (
    <div>
      <PageHeader title="ออเดอร์" subtitle={`${formatNumber(total)} รายการที่กำลังดำเนินการ`} />

      {/* บนมือถือ: เลื่อนแนวนอน (snap) · บนจอใหญ่: 4 คอลัมน์เต็ม */}
      <div className="-mx-4 sm:mx-0 px-4 sm:px-0 overflow-x-auto">
        <div className="flex gap-3 sm:grid sm:grid-cols-2 lg:grid-cols-4 min-w-max sm:min-w-0">
          {columns.map((col) => (
            <div
              key={col.status}
              className="w-[80vw] max-w-[300px] sm:w-auto sm:max-w-none shrink-0 snap-start"
            >
              {/* หัวคอลัมน์ + จำนวน */}
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className={cn("size-2.5 rounded-full", COL_ACCENT[col.status])} />
                <h2 className="text-sm font-semibold">{col.label}</h2>
                <span className="ml-auto text-xs text-zinc-400 tabular-nums bg-surface-2 rounded-full px-2 py-0.5">
                  {col.cards.length}
                </span>
              </div>

              <div className="space-y-2">
                {col.cards.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-6 text-center text-xs text-zinc-400">
                    ไม่มีออเดอร์
                  </div>
                )}
                {col.cards.map((c) => (
                  <Link
                    key={c.id}
                    href={`/fuelos/orders/${c.id}`}
                    className="block rounded-2xl border border-border bg-surface p-3.5 hover:shadow-sm transition-shadow"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-zinc-500 font-[family-name:var(--font-plex-mono)]">
                        {c.orderNo}
                      </span>
                      <span className="text-xs text-leaf-700 font-semibold tabular-nums">
                        +{formatBaht(c.profit)}
                      </span>
                    </div>
                    <div className="font-semibold truncate mt-1">{c.customerName}</div>
                    <div className="flex items-center gap-3 text-xs text-zinc-500 mt-2">
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Truck className="size-3.5" /> {formatNumber(c.totalLiters)} ล.
                      </span>
                      <span className="tabular-nums font-medium text-zinc-700">
                        {formatBaht(c.subtotal)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-zinc-400 mt-1.5">
                      <CalendarClock className="size-3" />
                      {c.scheduledDate ? `นัดส่ง ${bkkDate(c.scheduledDate)}` : "ยังไม่นัดส่ง"}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-zinc-400 mt-4 sm:hidden">เลื่อนซ้าย-ขวาเพื่อดูคอลัมน์อื่น · แตะการ์ดเพื่อจัดการสถานะ</p>
    </div>
  );
}
