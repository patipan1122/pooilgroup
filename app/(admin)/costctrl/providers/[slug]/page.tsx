// CostCtrl · Provider drill · /costctrl/providers/[slug]
// Detail page: 30-day cost chart · raw metric snapshots · sync-now button.

import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getProviderBySlug, getProviderDailyCosts, getProviderMonthlyHistory } from "@/lib/costctrl/data";
import { formatUsd, formatNumber, FREE_TIER_LIMITS, pctBar } from "@/lib/costctrl/pricing";
import { SyncProviderButton } from "../../_components/sync-buttons";

export const dynamic = "force-dynamic";

export default async function ProviderDrillPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const provider = await getProviderBySlug(slug);
  if (!provider) notFound();

  const firstOfMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));

  const [snaps, daily, monthly] = await Promise.all([
    prisma.costSnapshot.findMany({
      where: { providerId: provider.id, periodMonth: firstOfMonth },
      orderBy: { capturedAt: "desc" },
      take: 50,
    }),
    getProviderDailyCosts(provider.id, 30),
    getProviderMonthlyHistory(provider.id, 6),
  ]);

  const budgetMap = provider.budgetMonthly as Record<string, number>;
  const ym = `${firstOfMonth.getUTCFullYear()}-${String(firstOfMonth.getUTCMonth() + 1).padStart(2, "0")}`;
  const budget = budgetMap[ym] ?? budgetMap["default"] ?? 0;

  const maxCost = Math.max(0.001, ...daily.map((d) => d.costUsd));
  const freeTier = (FREE_TIER_LIMITS as Record<string, Record<string, number>>)[provider.slug] ?? {};

  // dedupe metrics for "latest" view
  const seen = new Set<string>();
  const latestPerMetric = snaps.filter((s) => {
    if (seen.has(s.metric)) return false;
    seen.add(s.metric);
    return true;
  });

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8 max-w-5xl mx-auto space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/costctrl" className="text-xs text-blue-600 hover:underline">← กลับภาพรวม</Link>
          <h1 className="text-2xl font-semibold text-zinc-900 mt-1">{provider.displayName}</h1>
          <p className="text-xs text-zinc-500 mt-0.5">{provider.pricingNote}</p>
        </div>
        <SyncProviderButton slug={provider.slug} />
      </header>

      {/* Budget + status */}
      <section className="rounded-xl ring-1 ring-zinc-200 bg-white p-4 grid gap-3 sm:grid-cols-3">
        <Stat label="งบเดือนนี้" value={formatUsd(budget)} />
        <Stat
          label="Sync ล่าสุด"
          value={provider.lastSyncAt ? new Date(provider.lastSyncAt).toLocaleString("th-TH") : "ยังไม่เคย"}
        />
        <Stat
          label="สถานะ"
          value={provider.lastSyncStatus ?? "—"}
          tone={
            provider.lastSyncStatus === "ok"
              ? "ok"
              : provider.lastSyncStatus?.startsWith("error")
                ? "alarm"
                : "warn"
          }
        />
      </section>

      {/* 6-month history */}
      <section className="rounded-xl ring-1 ring-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900 mb-3">ย้อนหลัง 6 เดือน</h2>
        {monthly.length === 0 ? (
          <p className="text-sm text-zinc-500">ยังไม่มีข้อมูล · เริ่มเก็บจากเดือนนี้</p>
        ) : (
          <div className="grid grid-cols-6 gap-2">
            {monthly.map((m) => (
              <div key={m.month} className="text-center">
                <div className="text-[10px] text-zinc-500 mb-1">{m.month}</div>
                <div className="h-16 bg-zinc-50 rounded flex items-end justify-center p-1">
                  <div
                    className="w-full bg-blue-400 rounded-sm"
                    style={{
                      height: `${Math.max(4, Math.round((m.costUsd / Math.max(0.01, ...monthly.map((x) => x.costUsd))) * 100))}%`,
                    }}
                    title={formatUsd(m.costUsd)}
                  />
                </div>
                <div className="text-[11px] font-mono text-zinc-700 mt-1">{formatUsd(m.costUsd)}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 30-day cost chart */}
      <section className="rounded-xl ring-1 ring-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900 mb-3">ต้นทุนรายวัน 30 วันล่าสุด</h2>
        {daily.length === 0 ? (
          <p className="text-sm text-zinc-500">ยังไม่มีข้อมูล · กดปุ่ม Sync เพื่อเก็บ snapshot</p>
        ) : (
          <div className="flex items-end gap-1 h-32">
            {daily.map((d) => {
              const h = Math.max(2, Math.round((d.costUsd / maxCost) * 100));
              return (
                <div
                  key={d.day}
                  title={`${d.day}: ${formatUsd(d.costUsd)}`}
                  className="flex-1 bg-blue-200 rounded-sm hover:bg-blue-400"
                  style={{ height: `${h}%` }}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* Latest metrics */}
      <section className="rounded-xl ring-1 ring-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900 mb-3">Metric เดือนนี้ (อัพเดทล่าสุด)</h2>
        {latestPerMetric.length === 0 ? (
          <p className="text-sm text-zinc-500">ยังไม่มี snapshot — กด Sync</p>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-zinc-600 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Metric</th>
                  <th className="text-right px-3 py-2 font-medium">Value</th>
                  <th className="text-right px-3 py-2 font-medium">% free tier</th>
                  <th className="text-right px-3 py-2 font-medium">Cost</th>
                  <th className="text-left px-3 py-2 font-medium">เก็บเมื่อ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {latestPerMetric.map((s) => {
                  const free = freeTier[s.metric];
                  const { pct, tone } = pctBar(Number(s.value), free ?? Infinity);
                  return (
                    <tr key={s.id}>
                      <td className="px-3 py-2 text-zinc-900">{s.metric}</td>
                      <td className="px-3 py-2 text-right font-mono text-zinc-900">{formatNumber(Number(s.value), s.unit)}</td>
                      <td className={`px-3 py-2 text-right text-xs ${tone === "alarm" ? "text-rose-700" : tone === "warn" ? "text-amber-700" : "text-zinc-500"}`}>
                        {free != null && isFinite(free) ? `${pct}%` : "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-zinc-700">{formatUsd(Number(s.costUsd))}</td>
                      <td className="px-3 py-2 text-xs text-zinc-500">{new Date(s.capturedAt).toLocaleString("th-TH")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* All snapshots (history) */}
      {snaps.length > latestPerMetric.length && (
        <details className="rounded-xl ring-1 ring-zinc-200 bg-white p-4">
          <summary className="text-sm font-medium text-zinc-900 cursor-pointer">ดู snapshot ทั้งหมด ({snaps.length})</summary>
          <div className="overflow-x-auto mt-3 -mx-4 sm:mx-0">
            <table className="min-w-full text-xs">
              <thead className="bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">เวลา</th>
                  <th className="text-left px-3 py-2 font-medium">Metric</th>
                  <th className="text-right px-3 py-2 font-medium">Value</th>
                  <th className="text-right px-3 py-2 font-medium">Cost</th>
                  <th className="text-left px-3 py-2 font-medium">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {snaps.map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-1.5 text-zinc-500">{new Date(s.capturedAt).toLocaleString("th-TH")}</td>
                    <td className="px-3 py-1.5 text-zinc-700">{s.metric}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{formatNumber(Number(s.value), s.unit)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{formatUsd(Number(s.costUsd))}</td>
                    <td className="px-3 py-1.5 text-zinc-500">{s.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "alarm" }) {
  const t = tone === "ok" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : tone === "alarm" ? "text-rose-700" : "text-zinc-900";
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`text-sm font-semibold ${t}`}>{value}</p>
    </div>
  );
}
