"use client";
// Insights · filter sidebar (desktop) / dropdown (mobile)
// Period (7d/30d/custom) · Branch multi-select · Group · Machine · Staff · Severity
// All filters serialize to URL params · cookie-free
// Reuses <FilterPill> primitive

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { FilterPill } from "@/components/ui/filter-pill";
import { X, Filter, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { InsightsView } from "./view-toggle";

interface Option {
  id: string;
  label: string;
}

interface FilterRailProps {
  view: InsightsView;
  /** YYYY-MM-DD */
  from: string;
  /** YYYY-MM-DD */
  to: string;
  branchId?: string;
  groupId?: string;
  machineId?: string;
  staffId?: string;
  severity?: "P0" | "P1" | "P2";
  branches: Option[];
  groups?: Option[];
  machines?: Option[];
  staff?: Option[];
}

type PeriodKey = "7d" | "30d" | "90d" | "custom";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function detectPeriod(from: string, to: string): PeriodKey {
  if (to !== todayISO()) return "custom";
  if (from === daysAgoISO(7)) return "7d";
  if (from === daysAgoISO(30)) return "30d";
  if (from === daysAgoISO(90)) return "90d";
  return "custom";
}

export function FilterRail(props: FilterRailProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [mobileOpen, setMobileOpen] = useState(false);

  const period = detectPeriod(props.from, props.to);

  function update(patch: Record<string, string | undefined>) {
    const next = new URLSearchParams(sp.toString());
    Object.entries(patch).forEach(([k, v]) => {
      if (v === undefined || v === "") next.delete(k);
      else next.set(k, v);
    });
    // changing a filter dismisses the open drawer
    next.delete("drill");
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  function setPeriod(p: PeriodKey) {
    if (p === "custom") {
      update({}); // no-op, rely on date pickers
      return;
    }
    const days = p === "7d" ? 7 : p === "30d" ? 30 : 90;
    update({ from: daysAgoISO(days), to: todayISO() });
  }

  const activeCount = [
    props.branchId,
    props.groupId,
    props.machineId,
    props.staffId,
    props.severity,
    period === "custom" ? "custom-date" : undefined,
  ].filter(Boolean).length;

  function clearAll() {
    startTransition(() =>
      router.push(`${pathname}?view=${props.view}&from=${daysAgoISO(7)}&to=${todayISO()}`),
    );
  }

  const showSeverity = props.view === "events" || props.view === "sessions";
  const showStaff = props.view !== "audit" && props.view !== "stock";
  const showMachine = props.view !== "branches" && props.view !== "stock";
  const showGroup = props.view !== "branches" && props.view !== "staff" && props.view !== "audit";

  const inner = (
    <div className="space-y-5">
      {/* Period */}
      <div>
        <p className="mb-2 text-xs font-bold text-zinc-700">ช่วงเวลา</p>
        <div className="flex flex-wrap gap-1.5">
          {(["7d", "30d", "90d"] as PeriodKey[]).map((p) => (
            <FilterPill
              key={p}
              active={period === p}
              onClick={() => setPeriod(p)}
            >
              {p === "7d" ? "7 วัน" : p === "30d" ? "30 วัน" : "90 วัน"}
            </FilterPill>
          ))}
          <FilterPill
            active={period === "custom"}
            onClick={() => setPeriod("custom")}
          >
            กำหนดเอง
          </FilterPill>
        </div>
        {period === "custom" && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="block text-[11px] text-zinc-500">
              จาก
              <input
                type="date"
                value={props.from}
                onChange={(e) => update({ from: e.target.value })}
                className="mt-1 block w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs"
              />
            </label>
            <label className="block text-[11px] text-zinc-500">
              ถึง
              <input
                type="date"
                value={props.to}
                onChange={(e) => update({ to: e.target.value })}
                className="mt-1 block w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs"
              />
            </label>
          </div>
        )}
      </div>

      {/* Branch */}
      <div>
        <p className="mb-2 text-xs font-bold text-zinc-700">สาขา</p>
        <select
          value={props.branchId ?? ""}
          onChange={(e) => update({ branch: e.target.value || undefined })}
          className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
        >
          <option value="">ทุกสาขา</option>
          {props.branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </div>

      {/* Group */}
      {showGroup && (props.groups?.length ?? 0) > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold text-zinc-700">กลุ่มตู้</p>
          <select
            value={props.groupId ?? ""}
            onChange={(e) => update({ group: e.target.value || undefined })}
            className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">ทุกกลุ่ม</option>
            {props.groups!.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Machine */}
      {showMachine && (props.machines?.length ?? 0) > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold text-zinc-700">ตู้</p>
          <select
            value={props.machineId ?? ""}
            onChange={(e) => update({ machine: e.target.value || undefined })}
            className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">ทุกตู้</option>
            {props.machines!.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Staff */}
      {showStaff && (props.staff?.length ?? 0) > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold text-zinc-700">พนักงาน</p>
          <select
            value={props.staffId ?? ""}
            onChange={(e) => update({ staff: e.target.value || undefined })}
            className="block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">ทุกคน</option>
            {props.staff!.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Severity */}
      {showSeverity && (
        <div>
          <p className="mb-2 text-xs font-bold text-zinc-700">ความรุนแรง</p>
          <div className="flex flex-wrap gap-1.5">
            <FilterPill
              active={!props.severity}
              onClick={() => update({ severity: undefined })}
            >
              ทุกระดับ
            </FilterPill>
            <FilterPill
              active={props.severity === "P0"}
              dotClass="bg-rose-500"
              onClick={() => update({ severity: "P0" })}
            >
              P0 ขัดขวาง
            </FilterPill>
            <FilterPill
              active={props.severity === "P1"}
              dotClass="bg-amber-500"
              onClick={() => update({ severity: "P1" })}
            >
              P1 เตือน
            </FilterPill>
            <FilterPill
              active={props.severity === "P2"}
              dotClass="bg-zinc-400"
              onClick={() => update({ severity: "P2" })}
            >
              P2 ข้อมูล
            </FilterPill>
          </div>
        </div>
      )}

      {activeCount > 0 && (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex items-center gap-1 text-xs font-semibold text-zinc-600 hover:text-zinc-900"
        >
          <X className="h-3 w-3" />
          ล้าง filter ({activeCount})
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile: collapsible button */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen((o) => !o)}
          className="flex w-full items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm font-semibold text-zinc-700"
          aria-expanded={mobileOpen}
        >
          <span className="inline-flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filter
            {activeCount > 0 && (
              <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-bold text-white tabular-nums">
                {activeCount}
              </span>
            )}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              mobileOpen && "rotate-180",
            )}
          />
        </button>
        {mobileOpen && (
          <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-4">
            {inner}
          </div>
        )}
      </div>

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:block lg:w-[280px] lg:shrink-0",
          pending && "opacity-60",
        )}
      >
        <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5">
          <p className="mb-4 inline-flex items-center gap-1.5 text-sm font-bold text-zinc-900">
            <Filter className="h-4 w-4 text-zinc-500" />
            Filter
            {activeCount > 0 && (
              <span className="rounded-full bg-zinc-900 px-2 py-0.5 text-[11px] font-bold text-white tabular-nums">
                {activeCount}
              </span>
            )}
          </p>
          {inner}
        </div>
      </aside>
    </>
  );
}
