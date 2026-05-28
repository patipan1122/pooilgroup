"use client";

// ClawFleet · Operations · Filter rail (left pane · 280px)
// Branch list + status tabs + severity chips. Drives URL params.

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { FilterPill } from "@/components/ui/filter-pill";
import { Building2, Layers, AlertOctagon } from "lucide-react";

type StatusFilter = "active" | "done" | "anomaly" | "all";
type SeverityFilter = "P0" | "P1" | "P2" | "all";

interface Branch {
  id: string;
  name: string;
  code: string;
  sessionCount: number;
}

interface Props {
  branches: Branch[];
  activeBranch?: string;
  activeStatus: StatusFilter;
  activeSeverity: SeverityFilter;
}

const STATUS_OPTIONS: Array<{ key: StatusFilter; label: string; dot: string }> = [
  { key: "all", label: "ทั้งหมด", dot: "bg-zinc-400" },
  { key: "active", label: "กำลังเก็บ", dot: "bg-blue-500" },
  { key: "anomaly", label: "รอ review", dot: "bg-rose-500" },
  { key: "done", label: "ปิดแล้ว", dot: "bg-emerald-500" },
];

const SEVERITY_OPTIONS: Array<{ key: SeverityFilter; label: string; dot: string }> = [
  { key: "all", label: "ทุกระดับ", dot: "bg-zinc-400" },
  { key: "P0", label: "P0", dot: "bg-rose-500" },
  { key: "P1", label: "P1", dot: "bg-amber-500" },
  { key: "P2", label: "P2", dot: "bg-zinc-500" },
];

export function OpsFilterRail({
  branches,
  activeBranch,
  activeStatus,
  activeSeverity,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const updateParam = useCallback(
    (key: string, value: string | undefined) => {
      const sp = new URLSearchParams(searchParams.toString());
      // Clear drawer when filtering
      sp.delete("focus");
      sp.delete("anomaly");
      if (value === undefined || value === "all") {
        sp.delete(key);
      } else {
        sp.set(key, value);
      }
      // Persist branch choice for 1 year (Slack-style "last-used branch sticks")
      if (key === "branch" && typeof document !== "undefined") {
        if (value === undefined || value === "all") {
          document.cookie = "cf_branch=; path=/; max-age=0; SameSite=Lax";
        } else {
          document.cookie = `cf_branch=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
        }
      }
      router.push(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-4">
      {/* Status tabs */}
      <section>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-500">
          <Layers className="h-3.5 w-3.5" />
          สถานะ
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_OPTIONS.map((opt) => (
            <FilterPill
              key={opt.key}
              active={activeStatus === opt.key}
              dotClass={opt.dot}
              onClick={() => updateParam("status", opt.key)}
            >
              {opt.label}
            </FilterPill>
          ))}
        </div>
      </section>

      {/* Severity chips */}
      <section>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-500">
          <AlertOctagon className="h-3.5 w-3.5" />
          ระดับ anomaly
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SEVERITY_OPTIONS.map((opt) => (
            <FilterPill
              key={opt.key}
              active={activeSeverity === opt.key}
              dotClass={opt.dot}
              onClick={() => updateParam("severity", opt.key)}
            >
              {opt.label}
            </FilterPill>
          ))}
        </div>
      </section>

      {/* Branch list */}
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-500">
          <Building2 className="h-3.5 w-3.5" />
          สาขา
        </div>
        <ul className="-mx-1 flex-1 space-y-0.5 overflow-y-auto">
          <li>
            <button
              type="button"
              onClick={() => updateParam("branch", undefined)}
              className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors ${
                !activeBranch
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-700 hover:bg-zinc-100"
              }`}
            >
              <span className="truncate font-medium">ทุกสาขา</span>
              <span className="tabular-nums text-xs opacity-70">
                {branches.reduce((sum, b) => sum + b.sessionCount, 0)}
              </span>
            </button>
          </li>
          {branches.map((b) => {
            const active = activeBranch === b.id;
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => updateParam("branch", b.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors ${
                    active
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-700 hover:bg-zinc-100"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{b.name}</span>
                    <span className={`ml-1.5 text-xs ${active ? "opacity-70" : "text-zinc-400"}`}>
                      {b.code}
                    </span>
                  </span>
                  {b.sessionCount > 0 && (
                    <span className={`tabular-nums text-xs ${active ? "opacity-70" : "text-zinc-500"}`}>
                      {b.sessionCount}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
