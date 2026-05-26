// ClawFleet · Operations · Anomaly strip (server component)
// Sticky-top horizontal strip above session grid. Severity-grouped.
// Click row → ?anomaly=<code> opens review drawer.

import Link from "next/link";
import { AlertTriangle, ChevronRight, ShieldCheck } from "lucide-react";
import { FLAG_LABEL_TH, FLAG_SEVERITY, type AnomalyFlag } from "@/lib/clawfleet/types";
import { formatTHB } from "@/lib/clawfleet/validation";

type AnomalyRow = {
  id: string;
  sessionCode: string;
  totalCashCents: number;
  closedAt: Date | null;
  anomalyFlags: string[];
  group: {
    name: string;
    branch: { name: string; code: string };
  };
  openedBy: { name: string | null } | null;
};

interface Props {
  anomalies: AnomalyRow[];
  activeAnomaly?: string;
}

const MAX_VISIBLE = 5;

function topSeverity(flags: string[]): "P0" | "P1" | "P2" {
  let top: "P0" | "P1" | "P2" = "P2";
  for (const f of flags) {
    const sev = FLAG_SEVERITY[f as AnomalyFlag];
    if (sev === "P0") return "P0";
    if (sev === "P1") top = "P1";
  }
  return top;
}

function sevDot(sev: "P0" | "P1" | "P2"): string {
  if (sev === "P0") return "bg-rose-500";
  if (sev === "P1") return "bg-amber-500";
  return "bg-zinc-400";
}

function sevBorder(sev: "P0" | "P1" | "P2"): string {
  if (sev === "P0") return "border-rose-200 bg-rose-50";
  if (sev === "P1") return "border-amber-200 bg-amber-50";
  return "border-zinc-200 bg-zinc-50";
}

function sevText(sev: "P0" | "P1" | "P2"): string {
  if (sev === "P0") return "text-rose-700";
  if (sev === "P1") return "text-amber-700";
  return "text-zinc-700";
}

function formatTimeAgo(d: Date | null): string {
  if (!d) return "—";
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return "เมื่อกี้";
  if (mins < 60) return `${mins} นาทีที่แล้ว`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} ชม ที่แล้ว`;
  const days = Math.floor(h / 24);
  return `${days} วันที่แล้ว`;
}

export function AnomalyMiniRow({ anomalies, activeAnomaly }: Props) {
  if (anomalies.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
        <ShieldCheck className="h-4 w-4" />
        <span>ไม่มี anomaly รอ review · ทุกรอบผ่าน cross-check</span>
      </div>
    );
  }

  // Sort by severity then time
  const sorted = [...anomalies].sort((a, b) => {
    const sA = topSeverity(a.anomalyFlags);
    const sB = topSeverity(b.anomalyFlags);
    const order = { P0: 0, P1: 1, P2: 2 };
    if (order[sA] !== order[sB]) return order[sA] - order[sB];
    return (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0);
  });

  const visible = sorted.slice(0, MAX_VISIBLE);
  const overflow = sorted.length - visible.length;

  return (
    <div className="sticky top-[64px] z-20 rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
          <AlertTriangle className="h-4 w-4 text-rose-600" />
          Anomaly รอ review
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-700 tabular-nums">
            {anomalies.length}
          </span>
        </div>
        <span className="hidden text-xs text-zinc-400 sm:inline">
          ⌨ a อนุมัติ · r recheck · e escalate
        </span>
      </div>

      <ul className="divide-y divide-zinc-100">
        {visible.map((a) => {
          const sev = topSeverity(a.anomalyFlags);
          const isActive = activeAnomaly === a.sessionCode;
          const topFlag = a.anomalyFlags[0] as AnomalyFlag | undefined;
          return (
            <li key={a.id}>
              <Link
                href={`/clawfleet/operations?anomaly=${a.sessionCode}`}
                scroll={false}
                className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                  isActive ? "bg-blue-50" : "hover:bg-zinc-50"
                }`}
              >
                <span className={`inline-flex h-6 w-9 shrink-0 items-center justify-center rounded-md border text-[11px] font-bold ${sevBorder(sev)} ${sevText(sev)}`}>
                  {sev}
                </span>
                <span className={`size-2 shrink-0 rounded-full ${sevDot(sev)}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-xs font-semibold text-zinc-900">
                      {a.sessionCode}
                    </span>
                    <span className="truncate text-xs text-zinc-500">
                      {a.group.branch.name} · {a.group.name}
                    </span>
                  </div>
                  <div className="truncate text-xs text-zinc-600">
                    {topFlag ? FLAG_LABEL_TH[topFlag] ?? topFlag : "—"}
                    {a.anomalyFlags.length > 1 && (
                      <span className="ml-1 text-zinc-400">+{a.anomalyFlags.length - 1}</span>
                    )}
                  </div>
                </div>
                <div className="hidden text-right sm:block">
                  <div className="text-sm font-semibold tabular-nums text-zinc-900">
                    {formatTHB(a.totalCashCents)}
                  </div>
                  <div className="text-[11px] text-zinc-400">{formatTimeAgo(a.closedAt)}</div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
              </Link>
            </li>
          );
        })}
        {overflow > 0 && (
          <li>
            <Link
              href="/clawfleet/anomalies"
              className="flex items-center justify-center gap-1 px-4 py-2 text-xs font-medium text-blue-600 hover:bg-blue-50"
            >
              ดูทั้งหมด +{overflow}
              <ChevronRight className="h-3 w-3" />
            </Link>
          </li>
        )}
      </ul>
    </div>
  );
}
