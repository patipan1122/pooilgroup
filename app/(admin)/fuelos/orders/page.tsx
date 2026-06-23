import Link from "next/link";
import { requireUser } from "@/lib/fuelos/auth";
import {
  listOrdersBoard,
  listOrdersByDay,
  ORDER_STATUS_META,
  type BoardCard,
  type DayGroup,
} from "@/lib/fuelos/orders-data";
import { PageHeader } from "@/components/fuelos/ui/page-header";
import { formatBaht, formatNumber, bkkDate } from "@/lib/fuelos/utils/format";
import { cn } from "@/lib/fuelos/utils/cn";
import { Truck, CalendarClock, CalendarDays, Columns3 } from "lucide-react";

type View = "status" | "day";

// สีหัวคอลัมน์ตามสถานะ
const COL_ACCENT: Record<string, string> = {
  AWAITING_CONFIRM: "bg-zinc-400",
  DELIVERING: "bg-info",
  DELIVERED_UNPAID: "bg-warning",
  CLOSED: "bg-leaf-500",
};

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const view: View = sp.view === "day" ? "day" : "status";

  if (view === "day") {
    const { groups, total } = await listOrdersByDay(user.orgId);
    return (
      <Shell view="day" total={total}>
        <DayBoard groups={groups} />
      </Shell>
    );
  }

  const { columns, total } = await listOrdersBoard(user.orgId);
  return (
    <Shell view="status" total={total}>
      <StatusBoard columns={columns} />
    </Shell>
  );
}

// โครงหน้า + หัวเรื่อง + ปุ่มสลับมุมมอง
function Shell({
  view,
  total,
  children,
}: {
  view: View;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <PageHeader title="ออเดอร์" subtitle={`${formatNumber(total)} รายการที่กำลังดำเนินการ`} />
      <ViewToggle view={view} />
      {children}
    </div>
  );
}

function ViewToggle({ view }: { view: View }) {
  const base = "inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl text-sm font-medium transition-colors";
  const on = "bg-surface shadow-sm text-zinc-900";
  const off = "text-zinc-500 hover:text-zinc-700";
  return (
    <div className="inline-flex gap-1 p-1 rounded-2xl bg-surface-2 mb-4">
      <Link href="/fuelos/orders?view=status" className={cn(base, view === "status" ? on : off)}>
        <Columns3 className="size-4" /> ตามสถานะ
      </Link>
      <Link href="/fuelos/orders?view=day" className={cn(base, view === "day" ? on : off)}>
        <CalendarDays className="size-4" /> ตามวัน
      </Link>
    </div>
  );
}

// ---- มุมมองตามสถานะ (Kanban เดิม) ----
function StatusBoard({
  columns,
}: {
  columns: { status: string; label: string; cards: BoardCard[] }[];
}) {
  return (
    <>
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
                  <OrderCard key={c.id} c={c} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-zinc-400 mt-4 sm:hidden">
        เลื่อนซ้าย-ขวาเพื่อดูคอลัมน์อื่น · แตะการ์ดเพื่อจัดการสถานะ
      </p>
    </>
  );
}

// ---- มุมมองตามวัน ----
function DayBoard({ groups }: { groups: DayGroup[] }) {
  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-surface/50 p-10 text-center text-sm text-zinc-400">
        ไม่มีออเดอร์ที่กำลังดำเนินการ
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.key}>
          <div className="flex items-center gap-2 mb-2.5 px-1">
            <h2 className="text-sm font-bold">{g.title}</h2>
            {g.sub && <span className="text-xs text-zinc-400">{g.sub}</span>}
            <span className="ml-auto text-xs text-zinc-500 tabular-nums">
              {g.cards.length} ออเดอร์ · {formatNumber(g.totalLiters)} ล. · {formatBaht(g.subtotal)}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
            {g.cards.map((c) => (
              <OrderCard key={c.id} c={c} showStatus />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// การ์ดออเดอร์ (ใช้ร่วม 2 มุมมอง · showStatus=true โชว์ป้ายสถานะแทนวันนัด)
function OrderCard({ c, showStatus = false }: { c: BoardCard; showStatus?: boolean }) {
  return (
    <Link
      href={`/fuelos/orders/${c.id}`}
      className="block rounded-2xl border border-border bg-surface p-3.5 hover:shadow-sm transition-shadow"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-zinc-500 font-[family-name:var(--font-plex-mono)]">
          {c.orderNo}
        </span>
        <span className="text-xs text-leaf-700 font-semibold tabular-nums">+{formatBaht(c.profit)}</span>
      </div>
      <div className="font-semibold truncate mt-1">{c.customerName}</div>
      <div className="flex items-center gap-3 text-xs text-zinc-500 mt-2">
        <span className="inline-flex items-center gap-1 tabular-nums">
          <Truck className="size-3.5" /> {formatNumber(c.totalLiters)} ล.
        </span>
        <span className="tabular-nums font-medium text-zinc-700">{formatBaht(c.subtotal)}</span>
      </div>
      {showStatus ? (
        <div className="mt-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
              ORDER_STATUS_META[c.status].tone,
            )}
          >
            {ORDER_STATUS_META[c.status].label}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-1 text-[11px] text-zinc-400 mt-1.5">
          <CalendarClock className="size-3" />
          {c.scheduledDate ? `นัดส่ง ${bkkDate(c.scheduledDate)}` : "ยังไม่นัดส่ง"}
        </div>
      )}
    </Link>
  );
}
