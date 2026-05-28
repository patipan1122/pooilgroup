// Insights · auxiliary views (server components)
// Promotes 4 previously-deferred views to first-class tables using existing queries:
//   - SessionsTable    · uses listSessions()
//   - BranchesTable    · aggregates getReportEvents() by branch
//   - StaffTable       · aggregates getReportEvents() by collectedBy
//   - StockTable       · loops listAccessibleBranches() + getStockBalance()
//
// All four reuse <DataTable> + <StatusPill> + <EmptyState> primitives.
// Drill: setting ?drill=<id> opens the universal drawer (GenericDrillBody handles fallback).

import Link from "next/link";
import {
  listSessions,
  getReportEvents,
  getStockBalance,
  listAccessibleBranches,
} from "@/lib/clawfleet/queries";
import { formatTHB } from "@/lib/clawfleet/validation";
import { DataTable, type TableRow } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import {
  ListChecks,
  Building2,
  Users,
  Package,
  Download,
} from "lucide-react";

// =============================================================
// Shared summary strip (mirrors EventsTable for visual consistency)
// =============================================================
function SummaryStrip({
  total,
  totalLabel,
  extras,
  exportHref,
}: {
  total: number;
  totalLabel: string;
  extras?: { label: string; value: string; tone?: "amber" | "rose" | "emerald" }[];
  exportHref?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <div>
          <span className="text-xs text-zinc-500">{totalLabel} </span>
          <span className="text-base font-bold text-zinc-900 tabular-nums">
            {total.toLocaleString("th-TH")}
          </span>
        </div>
        {extras?.map((x) => (
          <div key={x.label}>
            <span className="text-xs text-zinc-500">{x.label} </span>
            <span
              className={`text-base font-bold tabular-nums ${
                x.tone === "rose"
                  ? "text-rose-600"
                  : x.tone === "amber"
                    ? "text-amber-700"
                    : x.tone === "emerald"
                      ? "text-emerald-600"
                      : "text-zinc-900"
              }`}
            >
              {x.value}
            </span>
          </div>
        ))}
      </div>
      {exportHref && (
        <Link
          href={exportHref}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-bold text-zinc-700 hover:border-zinc-400"
        >
          <Download className="h-3.5 w-3.5" />
          CSV
        </Link>
      )}
    </div>
  );
}

// =============================================================
// Sessions
// =============================================================
interface SessionsTableProps {
  from: Date;
  to: Date;
  groupId?: string;
  baseParams: URLSearchParams;
}

export async function SessionsTable({
  from,
  to,
  groupId,
  baseParams,
}: SessionsTableProps) {
  const sessions = await listSessions({ from, to, groupId, take: 200 });

  if (sessions.length === 0) {
    return (
      <div className="space-y-4">
        <SummaryStrip total={0} totalLabel="ทั้งหมด" />
        <EmptyState
          icon={<ListChecks className="h-6 w-6" />}
          title="ไม่มีรอบเก็บในช่วงที่เลือก"
          description="ลองปรับช่วงเวลาให้กว้างขึ้น · หรือเอา filter กลุ่มออก"
        />
      </div>
    );
  }

  const openCount = sessions.filter((s) => s.status === "OPEN").length;
  const reviewCount = sessions.filter((s) => s.status === "ANOMALY_REVIEW").length;

  const rows: TableRow[] = sessions.map((s) => {
    const drillParams = new URLSearchParams(baseParams);
    drillParams.set("drill", s.id);
    const opened = new Date(s.openedAt);

    const statusPill =
      s.status === "OPEN" ? (
        <StatusPill tone="info" size="xs" dot>
          กำลังเก็บ
        </StatusPill>
      ) : s.status === "ANOMALY_REVIEW" ? (
        <StatusPill tone="warning" size="xs" dot>
          รอ review
        </StatusPill>
      ) : s.status === "LOCKED" ? (
        <StatusPill tone="neutral" size="xs">
          ปิดล็อค
        </StatusPill>
      ) : (
        <StatusPill tone="success" size="xs">
          ปิดแล้ว
        </StatusPill>
      );

    return {
      key: s.id,
      href: `?${drillParams.toString()}`,
      cells: {
        time: (
          <div className="leading-tight">
            <div className="text-sm text-zinc-900 tabular-nums">
              {opened.toLocaleDateString("th-TH", {
                day: "2-digit",
                month: "short",
              })}
            </div>
            <div className="text-[11px] text-zinc-500 tabular-nums">
              {opened.toLocaleTimeString("th-TH", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          </div>
        ),
        code: (
          <span className="font-mono text-xs font-semibold text-zinc-900">
            {s.sessionCode}
          </span>
        ),
        group: (
          <div>
            <div className="text-sm text-zinc-900">{s.group.name}</div>
            <div className="text-[11px] text-zinc-500">{s.group.branch.name}</div>
          </div>
        ),
        staff: (
          <span className="text-sm text-zinc-700">
            {s.openedBy?.name ?? "—"}
          </span>
        ),
        events: (
          <span className="text-sm font-semibold text-zinc-900 tabular-nums">
            {s._count.events.toLocaleString("th-TH")}
          </span>
        ),
        status: statusPill,
      },
    };
  });

  return (
    <div className="space-y-4">
      <SummaryStrip
        total={sessions.length}
        totalLabel="ทั้งหมด"
        extras={[
          ...(openCount > 0
            ? [{ label: "กำลังเก็บ", value: openCount.toLocaleString("th-TH") }]
            : []),
          ...(reviewCount > 0
            ? [
                {
                  label: "รอ review",
                  value: reviewCount.toLocaleString("th-TH"),
                  tone: "amber" as const,
                },
              ]
            : []),
        ]}
      />
      <DataTable
        columns={[
          { key: "time", header: "เปิดเมื่อ" },
          { key: "code", header: "รหัสรอบ" },
          { key: "group", header: "กลุ่ม · สาขา" },
          { key: "staff", header: "เปิดโดย" },
          { key: "events", header: "เหตุการณ์", align: "right" },
          { key: "status", header: "สถานะ" },
        ]}
        rows={rows}
      />
    </div>
  );
}

// =============================================================
// Branches — heatmap rollup from events
// =============================================================
interface BranchesTableProps {
  from: Date;
  to: Date;
  branchId?: string;
  baseParams: URLSearchParams;
}

export async function BranchesTable({
  from,
  to,
  branchId,
  baseParams,
}: BranchesTableProps) {
  const [events, branches] = await Promise.all([
    getReportEvents({ from, to, branchId }),
    listAccessibleBranches(),
  ]);

  if (branches.length === 0) {
    return (
      <EmptyState
        icon={<Building2 className="h-6 w-6" />}
        title="ยังไม่มีสาขา"
        description="ต้องเปิดสาขาที่ /clawfleet/settings ก่อน"
      />
    );
  }

  // Aggregate per branch
  type Roll = {
    branchId: string;
    branchName: string;
    eventCount: number;
    cashTotal: number;
    flagged: number;
    machinesSeen: Set<string>;
  };
  const map = new Map<string, Roll>();
  for (const b of branches) {
    map.set(b.id, {
      branchId: b.id,
      branchName: b.name,
      eventCount: 0,
      cashTotal: 0,
      flagged: 0,
      machinesSeen: new Set(),
    });
  }
  for (const e of events) {
    const r = map.get(e.machine.branch.id);
    if (!r) continue;
    r.eventCount += 1;
    r.cashTotal += e.cashCountedCents;
    r.machinesSeen.add(e.machine.id);
    if (e.anomalyFlags.length > 0) r.flagged += 1;
  }
  const rolled = Array.from(map.values()).sort(
    (a, b) => b.cashTotal - a.cashTotal,
  );

  const totalCash = rolled.reduce((s, r) => s + r.cashTotal, 0);
  const totalFlagged = rolled.reduce((s, r) => s + r.flagged, 0);

  const rows: TableRow[] = rolled.map((r) => {
    const drillParams = new URLSearchParams(baseParams);
    drillParams.set("branch", r.branchId);
    drillParams.set("view", "events");
    drillParams.delete("drill");
    return {
      key: r.branchId,
      href: `?${drillParams.toString()}`,
      cells: {
        name: (
          <div className="text-sm font-semibold text-zinc-900">
            {r.branchName}
          </div>
        ),
        machines: (
          <span className="text-sm text-zinc-700 tabular-nums">
            {r.machinesSeen.size.toLocaleString("th-TH")}
          </span>
        ),
        events: (
          <span className="text-sm text-zinc-700 tabular-nums">
            {r.eventCount.toLocaleString("th-TH")}
          </span>
        ),
        cash: (
          <span className="text-sm font-semibold text-zinc-900 tabular-nums">
            {formatTHB(r.cashTotal)}
          </span>
        ),
        flag:
          r.flagged > 0 ? (
            <StatusPill tone="warning" size="xs" dot>
              {r.flagged.toLocaleString("th-TH")}
            </StatusPill>
          ) : (
            <span className="text-[11px] text-zinc-400">—</span>
          ),
      },
    };
  });

  return (
    <div className="space-y-4">
      <SummaryStrip
        total={rolled.length}
        totalLabel="สาขา"
        extras={[
          { label: "รวมเงิน", value: formatTHB(totalCash) },
          ...(totalFlagged > 0
            ? [
                {
                  label: "flag",
                  value: totalFlagged.toLocaleString("th-TH"),
                  tone: "amber" as const,
                },
              ]
            : []),
        ]}
      />
      <p className="text-[11px] text-zinc-500">
        คลิกสาขา → กรองมุมมองเหตุการณ์เฉพาะสาขานั้น
      </p>
      <DataTable
        columns={[
          { key: "name", header: "สาขา" },
          { key: "machines", header: "ตู้ที่เก็บ", align: "right" },
          { key: "events", header: "ครั้งเก็บ", align: "right" },
          { key: "cash", header: "เงินรวม", align: "right" },
          { key: "flag", header: "flag" },
        ]}
        rows={rows}
      />
    </div>
  );
}

// =============================================================
// Staff — performer rollup from events
// =============================================================
interface StaffTableProps {
  from: Date;
  to: Date;
  branchId?: string;
  staffId?: string;
  baseParams: URLSearchParams;
}

export async function StaffTable({
  from,
  to,
  branchId,
  staffId,
  baseParams,
}: StaffTableProps) {
  const events = await getReportEvents({ from, to, branchId });

  if (events.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-6 w-6" />}
        title="ยังไม่มีข้อมูลพนักงานในช่วงนี้"
        description="ลองขยายช่วงเวลาหรือเอา filter สาขาออก"
      />
    );
  }

  type Roll = {
    staffId: string;
    name: string;
    eventCount: number;
    cashTotal: number;
    shortageCount: number;
    surplusCount: number;
    branches: Set<string>;
  };
  const map = new Map<string, Roll>();
  for (const e of events) {
    const k = e.collectedBy.id;
    let r = map.get(k);
    if (!r) {
      r = {
        staffId: k,
        name: e.collectedBy.name,
        eventCount: 0,
        cashTotal: 0,
        shortageCount: 0,
        surplusCount: 0,
        branches: new Set(),
      };
      map.set(k, r);
    }
    r.eventCount += 1;
    r.cashTotal += e.cashCountedCents;
    r.branches.add(e.machine.branch.id);
    const expected = (e.coinMeterAfter - e.coinMeterBefore) * 1000;
    const variance = e.cashCountedCents - expected;
    if (variance < 0) r.shortageCount += 1;
    else if (variance > 0) r.surplusCount += 1;
  }
  let rolled = Array.from(map.values()).sort(
    (a, b) => b.cashTotal - a.cashTotal,
  );
  if (staffId) rolled = rolled.filter((r) => r.staffId === staffId);

  if (rolled.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-6 w-6" />}
        title="ไม่พบพนักงานตาม filter"
        description="ลองเอา filter พนักงานออก"
      />
    );
  }

  const totalCash = rolled.reduce((s, r) => s + r.cashTotal, 0);
  const totalShortage = rolled.reduce((s, r) => s + r.shortageCount, 0);

  const rows: TableRow[] = rolled.map((r) => {
    const drillParams = new URLSearchParams(baseParams);
    drillParams.set("staff", r.staffId);
    drillParams.set("view", "events");
    drillParams.delete("drill");
    return {
      key: r.staffId,
      href: `?${drillParams.toString()}`,
      cells: {
        name: (
          <div>
            <div className="text-sm font-semibold text-zinc-900">{r.name}</div>
            <div className="text-[11px] text-zinc-500">
              {r.branches.size} สาขา
            </div>
          </div>
        ),
        events: (
          <span className="text-sm text-zinc-700 tabular-nums">
            {r.eventCount.toLocaleString("th-TH")}
          </span>
        ),
        cash: (
          <span className="text-sm font-semibold text-zinc-900 tabular-nums">
            {formatTHB(r.cashTotal)}
          </span>
        ),
        shortage:
          r.shortageCount > 0 ? (
            <StatusPill tone="danger" size="xs" dot>
              {r.shortageCount.toLocaleString("th-TH")}
            </StatusPill>
          ) : (
            <StatusPill tone="success" size="xs">
              0
            </StatusPill>
          ),
        surplus:
          r.surplusCount > 0 ? (
            <span className="text-xs font-semibold text-violet-600 tabular-nums">
              {r.surplusCount.toLocaleString("th-TH")}
            </span>
          ) : (
            <span className="text-[11px] text-zinc-400">—</span>
          ),
      },
    };
  });

  return (
    <div className="space-y-4">
      <SummaryStrip
        total={rolled.length}
        totalLabel="พนักงาน"
        extras={[
          { label: "รวมเงิน", value: formatTHB(totalCash) },
          ...(totalShortage > 0
            ? [
                {
                  label: "ครั้งที่ขาด",
                  value: totalShortage.toLocaleString("th-TH"),
                  tone: "rose" as const,
                },
              ]
            : []),
        ]}
      />
      <p className="text-[11px] text-zinc-500">
        คลิกพนักงาน → กรองมุมมองเหตุการณ์เฉพาะคนนั้น
      </p>
      <DataTable
        columns={[
          { key: "name", header: "พนักงาน" },
          { key: "events", header: "ครั้งเก็บ", align: "right" },
          { key: "cash", header: "เงินรวม", align: "right" },
          { key: "shortage", header: "ครั้งที่ขาด" },
          { key: "surplus", header: "ครั้งเกิน", align: "right" },
        ]}
        rows={rows}
      />
    </div>
  );
}

// =============================================================
// Stock — cross-branch balance
// =============================================================
interface StockTableProps {
  branchId?: string;
  baseParams: URLSearchParams;
}

export async function StockTable({ branchId, baseParams }: StockTableProps) {
  const branches = await listAccessibleBranches();
  const targetBranches = branchId
    ? branches.filter((b) => b.id === branchId)
    : branches;

  if (targetBranches.length === 0) {
    return (
      <EmptyState
        icon={<Package className="h-6 w-6" />}
        title="ยังไม่มีสาขาให้แสดงสต๊อก"
        description="เปิดสาขาที่ /clawfleet/settings ก่อน"
      />
    );
  }

  // Parallel balance fetch (1 query per branch · acceptable for <30 branches)
  const balances = await Promise.all(
    targetBranches.map(async (b) => ({
      branch: b,
      items: await getStockBalance(b.id),
    })),
  );

  // Flatten to one row per (branch, product)
  type Row = {
    branchId: string;
    branchName: string;
    productId: string;
    productSku: string;
    productName: string;
    qty: number;
  };
  const flat: Row[] = [];
  for (const { branch, items } of balances) {
    for (const it of items) {
      flat.push({
        branchId: branch.id,
        branchName: branch.name,
        productId: it.product.id,
        productSku: it.product.sku,
        productName: it.product.name,
        qty: it.qty,
      });
    }
  }

  if (flat.length === 0) {
    return (
      <EmptyState
        icon={<Package className="h-6 w-6" />}
        title="ยังไม่มีการเคลื่อนไหวสต๊อก"
        description="รับเข้าครั้งแรกที่ /clawfleet/stock ก่อน"
      />
    );
  }

  // Sort: low stock first (highlights risk), then by branch
  flat.sort((a, b) => {
    if (a.qty !== b.qty) return a.qty - b.qty;
    return a.branchName.localeCompare(b.branchName, "th");
  });

  const lowCount = flat.filter((r) => r.qty < 10).length;
  const totalUnits = flat.reduce((s, r) => s + r.qty, 0);

  const rows: TableRow[] = flat.map((r) => {
    const drillParams = new URLSearchParams(baseParams);
    drillParams.set("branch", r.branchId);
    drillParams.set("view", "machines");
    drillParams.delete("drill");
    return {
      key: `${r.branchId}:${r.productId}`,
      href: `?${drillParams.toString()}`,
      cells: {
        branch: (
          <span className="text-sm text-zinc-700">{r.branchName}</span>
        ),
        product: (
          <div>
            <div className="text-sm font-semibold text-zinc-900">
              {r.productName}
            </div>
            <div className="font-mono text-[11px] text-zinc-500">
              {r.productSku}
            </div>
          </div>
        ),
        qty: (
          <span
            className={`text-sm font-semibold tabular-nums ${
              r.qty < 0
                ? "text-rose-600"
                : r.qty < 10
                  ? "text-amber-700"
                  : "text-zinc-900"
            }`}
          >
            {r.qty.toLocaleString("th-TH")}
          </span>
        ),
        status:
          r.qty < 0 ? (
            <StatusPill tone="danger" size="xs" dot>
              ติดลบ
            </StatusPill>
          ) : r.qty < 10 ? (
            <StatusPill tone="warning" size="xs" dot>
              ใกล้หมด
            </StatusPill>
          ) : (
            <StatusPill tone="success" size="xs">
              พอ
            </StatusPill>
          ),
      },
    };
  });

  return (
    <div className="space-y-4">
      <SummaryStrip
        total={flat.length}
        totalLabel="รายการ"
        extras={[
          {
            label: "หน่วยรวม",
            value: totalUnits.toLocaleString("th-TH"),
          },
          ...(lowCount > 0
            ? [
                {
                  label: "ใกล้หมด",
                  value: lowCount.toLocaleString("th-TH"),
                  tone: "amber" as const,
                },
              ]
            : []),
        ]}
      />
      <p className="text-[11px] text-zinc-500">
        เรียงตามจำนวนคงเหลือน้อย → มาก · คลิก row → ดูตู้ของสาขานั้น
      </p>
      <DataTable
        columns={[
          { key: "branch", header: "สาขา" },
          { key: "product", header: "สินค้า" },
          { key: "qty", header: "คงเหลือ", align: "right" },
          { key: "status", header: "สถานะ" },
        ]}
        rows={rows}
      />
    </div>
  );
}
