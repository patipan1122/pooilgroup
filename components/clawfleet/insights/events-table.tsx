// Insights · events table (server component)
// Uses existing <DataTable> primitive — pre-renders cells (RSC → CC boundary)
// Sticky thead inherited from DataTable (top-14 sm:top-16 z-20)
// Row click sets ?drill=<eventId>

import Link from "next/link";
import { DataTable, type TableRow } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { BarChart3, Download, ArrowUpDown } from "lucide-react";
import { getReportEvents } from "@/lib/clawfleet/queries";
import { formatTHB, severityLight } from "@/lib/clawfleet/validation";

interface EventsTableProps {
  from: Date;
  to: Date;
  branchId?: string;
  machineId?: string;
  /** Current URL `?` params (preserved for drill links) */
  baseParams: URLSearchParams;
  /** CSV export href */
  exportHref: string;
}

export async function EventsTable({
  from,
  to,
  branchId,
  machineId,
  baseParams,
  exportHref,
}: EventsTableProps) {
  const events = await getReportEvents({ from, to, branchId, machineId });

  const totalCash = events.reduce((s, e) => s + e.cashCountedCents, 0);
  const flagged = events.filter((e) => e.anomalyFlags.length > 0).length;

  if (events.length === 0) {
    return (
      <div className="space-y-4">
        <SummaryStrip total={0} cash={0} flagged={0} exportHref={exportHref} />
        <EmptyState
          icon={<BarChart3 className="h-6 w-6" />}
          title="ไม่มีเหตุการณ์ในช่วงที่เลือก"
          description="ลองปรับช่วงเวลาให้กว้างขึ้น · หรือเอา filter สาขา/ตู้ออก"
        />
      </div>
    );
  }

  const rows: TableRow[] = events.map((e) => {
    const expected = (e.coinMeterAfter - e.coinMeterBefore) * 1000;
    const variance = e.cashCountedCents - expected;
    const light = severityLight(variance);
    const drillParams = new URLSearchParams(baseParams);
    drillParams.set("drill", e.id);

    const ts = new Date(e.collectedAt);
    const dateStr = ts.toLocaleDateString("th-TH", {
      day: "2-digit",
      month: "short",
    });
    const timeStr = ts.toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
    });

    return {
      key: e.id,
      href: `?${drillParams.toString()}`,
      cells: {
        time: (
          <div className="leading-tight">
            <div className="text-sm text-zinc-900 tabular-nums">{dateStr}</div>
            <div className="text-[11px] text-zinc-500 tabular-nums">
              {timeStr}
            </div>
          </div>
        ),
        session: (
          <span className="font-mono text-xs text-zinc-700">
            {e.session?.sessionCode ?? "—"}
          </span>
        ),
        machine: (
          <div>
            <div className="font-mono text-xs font-semibold text-zinc-900">
              {e.machine.code}
            </div>
            <div className="text-[11px] text-zinc-500">
              {e.machine.branch.name}
            </div>
          </div>
        ),
        staff: (
          <span className="text-sm text-zinc-700">{e.collectedBy.name}</span>
        ),
        cash: (
          <span className="text-sm font-semibold text-zinc-900 tabular-nums">
            {formatTHB(e.cashCountedCents)}
          </span>
        ),
        variance: (
          <span
            className={`text-sm font-semibold tabular-nums ${
              variance < 0
                ? "text-rose-600"
                : variance > 0
                  ? "text-violet-600"
                  : "text-emerald-600"
            }`}
          >
            {variance > 0 ? "+" : ""}
            {formatTHB(variance)}
          </span>
        ),
        status: (
          <StatusPill
            tone={
              light === "danger" ? "danger" : light === "warn" ? "warning" : "success"
            }
            dot
            size="xs"
          >
            {light === "danger" ? "ขาดเยอะ" : light === "warn" ? "ขาดน้อย" : "ปกติ"}
          </StatusPill>
        ),
      },
    };
  });

  return (
    <div className="space-y-4">
      <SummaryStrip
        total={events.length}
        cash={totalCash}
        flagged={flagged}
        exportHref={exportHref}
      />
      <DataTable
        columns={[
          { key: "time", header: <SortHeader>เวลา</SortHeader> },
          { key: "session", header: "รอบ" },
          { key: "machine", header: "ตู้ · สาขา" },
          { key: "staff", header: "พนักงาน" },
          { key: "cash", header: "เงินสด", align: "right" },
          { key: "variance", header: "ส่วนต่าง", align: "right" },
          { key: "status", header: "สถานะ" },
        ]}
        rows={rows}
      />
    </div>
  );
}

function SortHeader({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <ArrowUpDown className="h-3 w-3 text-zinc-400" />
    </span>
  );
}

function SummaryStrip({
  total,
  cash,
  flagged,
  exportHref,
}: {
  total: number;
  cash: number;
  flagged: number;
  exportHref: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <div>
          <span className="text-xs text-zinc-500">ทั้งหมด </span>
          <span className="text-base font-bold text-zinc-900 tabular-nums">
            {total.toLocaleString("th-TH")}
          </span>
          <span className="text-xs text-zinc-500"> รายการ</span>
        </div>
        <div>
          <span className="text-xs text-zinc-500">รวมเงิน </span>
          <span className="text-base font-bold text-zinc-900 tabular-nums">
            {formatTHB(cash)}
          </span>
        </div>
        {flagged > 0 && (
          <div>
            <span className="text-xs text-zinc-500">flag </span>
            <span className="text-base font-bold text-amber-700 tabular-nums">
              {flagged.toLocaleString("th-TH")}
            </span>
          </div>
        )}
      </div>
      <Link
        href={exportHref}
        className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:border-zinc-400"
      >
        <Download className="h-3.5 w-3.5" />
        CSV
      </Link>
    </div>
  );
}
