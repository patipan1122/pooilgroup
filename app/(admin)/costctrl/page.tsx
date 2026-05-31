// CostCtrl · Overview · /costctrl
// CEO-facing dashboard — 5 provider cards · MTD cost vs budget · alerts strip.

import Link from "next/link";
import { listProviderSummaries, listRecentAlertEvents } from "@/lib/costctrl/data";
import { formatUsd, formatNumber } from "@/lib/costctrl/pricing";
import { SyncAllButton } from "./_components/sync-buttons";

const TONE_BG: Record<"ok" | "warn" | "alarm", string> = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  alarm: "bg-rose-50 text-rose-800 ring-rose-200",
};

const TONE_BAR: Record<"ok" | "warn" | "alarm", string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  alarm: "bg-rose-500",
};

const CATEGORY_LABEL: Record<string, string> = {
  hosting: "Hosting",
  database: "Database",
  storage: "Storage",
  ai: "AI",
};

// Human labels for known metrics — overview card uses these instead of raw metric keys
const METRIC_LABEL_TH: Record<string, string> = {
  bandwidth_gb: "Bandwidth",
  function_invocations: "Function calls",
  build_minutes: "Build minutes",
  edge_requests: "Edge requests",
  db_size_mb: "ขนาด DB",
  egress_gb: "Egress",
  mau: "Active users (30d)",
  users_total: "Users ทั้งหมด",
  active_connections: "Active connections",
  storage_gb: "Storage",
  class_a_ops: "Write ops (Class A)",
  class_b_ops: "Read ops (Class B)",
  object_count: "Object count",
  bucket_count: "Buckets",
  tokens_in: "Tokens เข้า",
  tokens_out: "Tokens ออก",
  calls: "Calls",
  cost_usd: "ค่าใช้จ่าย",
  plan: "Plan",
};

function timeAgo(d: Date | null): string {
  if (!d) return "ยังไม่เคย sync";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return `${s}s ที่แล้ว`;
  if (s < 3600) return `${Math.round(s / 60)}m ที่แล้ว`;
  if (s < 86400) return `${Math.round(s / 3600)}h ที่แล้ว`;
  return `${Math.round(s / 86400)}d ที่แล้ว`;
}

export const dynamic = "force-dynamic";

export default async function CostCtrlOverviewPage() {
  const [summaries, alerts] = await Promise.all([
    listProviderSummaries(),
    listRecentAlertEvents(5),
  ]);

  const totalMtd = summaries.reduce((s, p) => s + p.costMtdUsd, 0);
  const totalBudget = summaries.reduce((s, p) => s + p.budgetUsd, 0);
  const overBudgetCount = summaries.filter((p) => p.budgetPctTone === "alarm").length;
  const warnCount = summaries.filter((p) => p.budgetPctTone === "warn").length;

  const monthLabel = new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long" });

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8 max-w-6xl mx-auto space-y-6">
      {/* Hero */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs text-zinc-500 mb-0.5">ศูนย์ควบคุมต้นทุน · {monthLabel}</p>
          <h1 className="text-2xl font-semibold text-zinc-900">ต้นทุนเดือนนี้</h1>
        </div>
        <SyncAllButton />
      </header>

      {/* 4 KPIs */}
      <section className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Kpi label="ใช้ไปเดือนนี้" value={formatUsd(totalMtd)} tone={overBudgetCount > 0 ? "alarm" : warnCount > 0 ? "warn" : "ok"} />
        <Kpi label="งบเดือนนี้" value={formatUsd(totalBudget)} tone="ok" />
        <Kpi label="เกินเพดาน" value={`${overBudgetCount} provider`} tone={overBudgetCount > 0 ? "alarm" : "ok"} />
        <Kpi label="ใกล้เพดาน" value={`${warnCount} provider`} tone={warnCount > 0 ? "warn" : "ok"} />
      </section>

      {/* Alerts strip */}
      {alerts.length > 0 && (
        <section className="rounded-xl ring-1 ring-rose-200 bg-rose-50/60 p-4">
          <h2 className="text-sm font-semibold text-rose-900 mb-2">⚠️ เหตุการณ์เตือนล่าสุด</h2>
          <ul className="space-y-1.5 text-sm">
            {alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 text-rose-900/90">
                <span className="font-medium">{a.rule.provider.displayName}</span>
                <span className="text-rose-700/80">{a.rule.metric}</span>
                <span className="text-rose-600/80 text-xs">
                  {Number(a.observedValue).toFixed(2)} / {Number(a.thresholdValue).toFixed(2)} · {new Date(a.triggeredAt).toLocaleString("th-TH")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Provider cards */}
      <section className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {summaries.map((p) => {
          const showHeadline = p.headline && p.headline.metric !== "cost_usd";
          const headlineFree = p.headline?.free;
          const headlineHasFree = headlineFree != null && isFinite(headlineFree);
          const headlinePct = p.headline?.pct ?? 0;
          const headlineTone = p.headline?.tone ?? "ok";
          return (
            <Link
              key={p.id}
              href={`/costctrl/providers/${p.slug}`}
              className="block rounded-xl ring-1 ring-zinc-200 bg-white p-4 hover:ring-blue-300 hover:shadow-sm transition"
            >
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-zinc-500">{CATEGORY_LABEL[p.category] ?? p.category}</p>
                  <h3 className="text-base font-semibold text-zinc-900">{p.displayName}</h3>
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full ring-1 ${TONE_BG[p.budgetPctTone]}`}>
                  ${p.costMtdUsd.toFixed(2)} / {p.budgetPct}%
                </span>
              </div>

              {/* Headline metric (free-tier visualization · the "อะไรใกล้เพดาน" signal) */}
              {showHeadline && p.headline && (
                <div className="mb-3">
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="text-xs text-zinc-500">{METRIC_LABEL_TH[p.headline.metric] ?? p.headline.metric}</span>
                    {headlineHasFree && (
                      <span className={`text-[11px] font-medium ${headlineTone === "alarm" ? "text-rose-700" : headlineTone === "warn" ? "text-amber-700" : "text-emerald-700"}`}>
                        {headlinePct}% ของฟรี
                      </span>
                    )}
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-semibold text-zinc-900">{formatNumber(p.headline.value, p.headline.unit)}</span>
                    {headlineHasFree && (
                      <span className="text-xs text-zinc-500">/ {formatNumber(headlineFree, p.headline.unit)} ฟรี</span>
                    )}
                  </div>
                  {headlineHasFree && (
                    <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden mt-1">
                      <div className={`h-full ${TONE_BAR[headlineTone]}`} style={{ width: `${Math.min(100, headlinePct)}%` }} />
                    </div>
                  )}
                </div>
              )}

              {/* Budget ladder when headline = cost_usd (AI providers) */}
              {!showHeadline && (
                <div className="mb-3">
                  <div className="flex items-baseline gap-1">
                    <span className="text-xl font-semibold text-zinc-900">{formatUsd(p.costMtdUsd)}</span>
                    <span className="text-xs text-zinc-500">/ {formatUsd(p.budgetUsd)} งบ</span>
                  </div>
                  <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden mt-1">
                    <div className={`h-full ${TONE_BAR[p.budgetPctTone]}`} style={{ width: `${Math.min(100, p.budgetPct)}%` }} />
                  </div>
                </div>
              )}

              {/* Other metrics chips */}
              {p.metrics.length > 1 && (
                <div className="flex flex-wrap gap-1 text-[11px] text-zinc-600 mb-2">
                  {p.metrics
                    .filter((m) => m.metric !== p.headline?.metric && m.metric !== "plan" && m.metric !== "_gql_error")
                    .slice(0, 4)
                    .map((m) => (
                      <span key={m.metric} className="px-1.5 py-0.5 rounded bg-zinc-50 ring-1 ring-zinc-100">
                        <span className="text-zinc-500">{METRIC_LABEL_TH[m.metric] ?? m.metric}:</span>{" "}
                        <span className="font-mono text-zinc-900">{formatNumber(m.value, m.unit)}</span>
                        {m.pct != null ? <span className="text-zinc-400"> · {m.pct}%</span> : null}
                      </span>
                    ))}
                </div>
              )}

              {p.planNote && (
                <p className="text-[11px] text-amber-700 bg-amber-50 ring-1 ring-amber-100 rounded px-2 py-1 mb-2">
                  💡 {p.planNote}
                </p>
              )}

              <div className="pt-2 border-t border-zinc-100 flex items-center justify-between text-[11px] text-zinc-500">
                <span>{timeAgo(p.lastSyncAt)}</span>
                <span className={p.lastSyncStatus === "ok" ? "text-emerald-600" : p.lastSyncStatus?.startsWith("error") ? "text-rose-600" : "text-zinc-500"}>
                  {p.lastSyncStatus ?? "ยังไม่ sync"}
                </span>
              </div>
            </Link>
          );
        })}
      </section>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: "ok" | "warn" | "alarm" }) {
  return (
    <div className={`rounded-xl ring-1 p-3 ${TONE_BG[tone]}`}>
      <p className="text-[11px] uppercase tracking-wide opacity-75">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
