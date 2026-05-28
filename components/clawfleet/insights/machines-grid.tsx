// Insights · machines grid (server component)
// Card-per-machine with 30d revenue sparkline · status dot · last-collected
// Click card → drill drawer (?drill=<machineCode>)

import Link from "next/link";
import { listMachines, getReportEvents } from "@/lib/clawfleet/queries";
import { Sparkline } from "./sparkline";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusPill } from "@/components/ui/status-pill";
import { Gamepad2 } from "lucide-react";
import { formatTHB } from "@/lib/clawfleet/validation";

interface MachinesGridProps {
  branchId?: string;
  /** Current URL params; we append drill=<code> on each card */
  baseParams: URLSearchParams;
}

export async function MachinesGrid({ branchId, baseParams }: MachinesGridProps) {
  const machines = await listMachines({ branchId });

  if (machines.length === 0) {
    return (
      <EmptyState
        icon={<Gamepad2 className="h-6 w-6" />}
        title="ยังไม่มีตู้"
        description="เพิ่มตู้ที่หน้า /clawfleet/machines/new ก่อน"
      />
    );
  }

  // 30d revenue series per machine — fetched once with a wide window, grouped client-side.
  // TODO[claude-design]: extract getMachineAnalytics(code, period) → returns
  //   { sparkSeries: number[], totalRevenueCents, lastEventAt } per machine (avoid N+1)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  thirtyDaysAgo.setHours(0, 0, 0, 0);
  const now = new Date();
  const recent = await getReportEvents({
    from: thirtyDaysAgo,
    to: now,
    branchId,
  });

  // Bucket events by machineId × day (UTC)
  const byMachine = new Map<string, Map<number, number>>();
  for (const e of recent) {
    const dayKey = Math.floor(
      new Date(e.collectedAt).getTime() / (1000 * 60 * 60 * 24),
    );
    let m = byMachine.get(e.machineId);
    if (!m) {
      m = new Map();
      byMachine.set(e.machineId, m);
    }
    m.set(dayKey, (m.get(dayKey) ?? 0) + e.cashCountedCents);
  }
  const todayKey = Math.floor(now.getTime() / (1000 * 60 * 60 * 24));
  function seriesFor(machineId: string): number[] {
    const m = byMachine.get(machineId);
    if (!m) return new Array(30).fill(0);
    return Array.from({ length: 30 }, (_, i) => m.get(todayKey - (29 - i)) ?? 0);
  }
  function lastEventAt(machineId: string): Date | null {
    const m = byMachine.get(machineId);
    if (!m || m.size === 0) return null;
    const lastDay = Math.max(...m.keys());
    return new Date(lastDay * 1000 * 60 * 60 * 24);
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {machines.map((m) => {
        const drillParams = new URLSearchParams(baseParams);
        drillParams.set("drill", m.code);
        const data = seriesFor(m.id);
        const total = data.reduce((s, v) => s + v, 0);
        const lastDay = lastEventAt(m.id);
        const daysQuiet = lastDay
          ? Math.floor(
              (now.getTime() - lastDay.getTime()) / (1000 * 60 * 60 * 24),
            )
          : null;
        const sparkTone =
          total === 0
            ? "zinc"
            : daysQuiet != null && daysQuiet > 3
              ? "amber"
              : "indigo";

        return (
          <Link
            key={m.id}
            href={`?${drillParams.toString()}`}
            className="group block rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-400 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-mono text-sm font-bold text-zinc-900">
                  {m.code}
                </div>
                {m.nickname && (
                  <div className="truncate text-[11px] text-zinc-500">
                    {m.nickname}
                  </div>
                )}
              </div>
              <span
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                  m.isActive ? "bg-emerald-500" : "bg-zinc-300"
                }`}
                title={m.isActive ? "เปิดใช้งาน" : "ปิด"}
              />
            </div>

            <div className="mt-2 flex items-center gap-1.5">
              <StatusPill
                tone={m.kind === "CLAW" ? "info" : "amber"}
                size="xs"
              >
                {m.kind === "CLAW" ? "ตู้คีบ" : "ตู้แลก"}
              </StatusPill>
              {m.group?.name && (
                <span className="truncate text-[11px] text-zinc-500">
                  · {m.group.name}
                </span>
              )}
            </div>
            <div className="mt-1 text-[11px] text-zinc-500">
              {m.branch.name}
            </div>

            <div className="mt-3 flex items-end justify-between gap-2">
              <div>
                <div className="text-[11px] text-zinc-500">รายได้ 30 วัน</div>
                <div className="text-base font-bold text-zinc-900 tabular-nums">
                  {formatTHB(total)}
                </div>
              </div>
              <Sparkline
                data={data}
                tone={sparkTone}
                width={88}
                height={28}
                ariaLabel={`รายได้ 30 วันของตู้ ${m.code}`}
              />
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-2 text-[11px] text-zinc-500">
              <span>
                สต๊อก{" "}
                <span
                  className={`font-semibold tabular-nums ${
                    m.kind === "CLAW" && m.lastDollStock < 10
                      ? "text-rose-600"
                      : "text-zinc-700"
                  }`}
                >
                  {m.kind === "CLAW" ? m.lastDollStock : "-"}
                </span>
              </span>
              <span className="tabular-nums">
                {daysQuiet == null
                  ? "ยังไม่เคยเก็บ"
                  : daysQuiet === 0
                    ? "เก็บวันนี้"
                    : `${daysQuiet} วันก่อน`}
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
