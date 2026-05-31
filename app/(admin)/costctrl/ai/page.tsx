// CostCtrl · AI tokens · /costctrl/ai
// Breakdown of MTD AI usage by provider × module × model × endpoint.
// Reads from ai_usage table (extended with provider/model/module cols in
// migration 20260531000000).

import Link from "next/link";
import { aggregateAiUsageMtd, aiUsageMtdTotalsByProvider } from "@/lib/costctrl/data";
import { formatUsd, formatNumber } from "@/lib/costctrl/pricing";

export const dynamic = "force-dynamic";

const MODULE_TH: Record<string, string> = {
  cashhub: "CashHub",
  docuflow: "DocuFlow",
  recruit: "Recruit",
  inbox: "Inbox",
  chairops: "ChairOps",
  playland: "Playland",
  repairs: "Repairs",
  clawfleet: "ClawFleet",
};

export default async function CostCtrlAiPage() {
  const [rows, byProvider] = await Promise.all([
    aggregateAiUsageMtd(),
    aiUsageMtdTotalsByProvider(),
  ]);

  // Group rows by module for compact display
  const byModule = new Map<string, { module: string; tokensIn: number; tokensOut: number; costUsd: number; calls: number }>();
  for (const r of rows) {
    const key = r.module ?? "(unknown)";
    const cur = byModule.get(key) ?? { module: key, tokensIn: 0, tokensOut: 0, costUsd: 0, calls: 0 };
    cur.tokensIn += r.input_tokens;
    cur.tokensOut += r.output_tokens;
    cur.costUsd += r.cost_usd;
    cur.calls += r.calls;
    byModule.set(key, cur);
  }
  const moduleRows = Array.from(byModule.values()).sort((a, b) => b.costUsd - a.costUsd);

  const grandTotalCost = byProvider.reduce((s, r) => s + r.costUsd, 0);
  const grandTotalCalls = byProvider.reduce((s, r) => s + r.calls, 0);
  const grandTotalIn = byProvider.reduce((s, r) => s + r.tokensIn, 0);
  const grandTotalOut = byProvider.reduce((s, r) => s + r.tokensOut, 0);

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8 max-w-6xl mx-auto space-y-6">
      <header>
        <Link href="/costctrl" className="text-xs text-blue-600 hover:underline">← กลับภาพรวม</Link>
        <h1 className="text-2xl font-semibold text-zinc-900 mt-1">AI Tokens · เดือนนี้</h1>
        <p className="text-sm text-zinc-500">รวมทุก call ไปยัง Anthropic + Gemini · กลุ่มตาม provider · module · model</p>
      </header>

      {/* 4 KPIs */}
      <section className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        <Kpi label="ค่า AI รวม" value={formatUsd(grandTotalCost)} />
        <Kpi label="จำนวน calls" value={formatNumber(grandTotalCalls)} />
        <Kpi label="Tokens เข้า" value={formatNumber(grandTotalIn, "tok")} />
        <Kpi label="Tokens ออก" value={formatNumber(grandTotalOut, "tok")} />
      </section>

      {/* By provider */}
      <section className="rounded-xl ring-1 ring-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900 mb-3">แยกตาม Provider</h2>
        {byProvider.length === 0 ? (
          <p className="text-sm text-zinc-500">ยังไม่มี call · หรือ AI call ไม่ได้บันทึก (ดู Phase 7 wrap audit)</p>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-zinc-600 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Provider</th>
                  <th className="text-right px-3 py-2 font-medium">Calls</th>
                  <th className="text-right px-3 py-2 font-medium">Tokens เข้า</th>
                  <th className="text-right px-3 py-2 font-medium">Tokens ออก</th>
                  <th className="text-right px-3 py-2 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {byProvider.map((r) => (
                  <tr key={r.provider}>
                    <td className="px-3 py-2 text-zinc-900 font-medium">{r.provider}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatNumber(r.calls)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatNumber(r.tokensIn)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatNumber(r.tokensOut)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatUsd(r.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* By module */}
      <section className="rounded-xl ring-1 ring-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900 mb-3">แยกตาม Module</h2>
        {moduleRows.length === 0 ? (
          <p className="text-sm text-zinc-500">—</p>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-zinc-600 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Module</th>
                  <th className="text-right px-3 py-2 font-medium">Calls</th>
                  <th className="text-right px-3 py-2 font-medium">Tokens</th>
                  <th className="text-right px-3 py-2 font-medium">Cost</th>
                  <th className="text-right px-3 py-2 font-medium">% รวม</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {moduleRows.map((r) => (
                  <tr key={r.module}>
                    <td className="px-3 py-2 text-zinc-900">{MODULE_TH[r.module] ?? r.module}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatNumber(r.calls)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatNumber(r.tokensIn + r.tokensOut, "tok")}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatUsd(r.costUsd)}</td>
                    <td className="px-3 py-2 text-right text-xs text-zinc-500">
                      {grandTotalCost > 0 ? `${Math.round((r.costUsd / grandTotalCost) * 100)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Detail rows */}
      <section className="rounded-xl ring-1 ring-zinc-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-zinc-900 mb-3">รายละเอียดทุก endpoint × model</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-zinc-500">—</p>
        ) : (
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="min-w-full text-xs">
              <thead className="bg-zinc-50 text-zinc-600">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Provider</th>
                  <th className="text-left px-3 py-2 font-medium">Model</th>
                  <th className="text-left px-3 py-2 font-medium">Module</th>
                  <th className="text-left px-3 py-2 font-medium">Endpoint</th>
                  <th className="text-right px-3 py-2 font-medium">Calls</th>
                  <th className="text-right px-3 py-2 font-medium">In</th>
                  <th className="text-right px-3 py-2 font-medium">Out</th>
                  <th className="text-right px-3 py-2 font-medium">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.slice(0, 100).map((r, i) => (
                  <tr key={`${r.provider}-${r.endpoint}-${i}`}>
                    <td className="px-3 py-1.5">{r.provider}</td>
                    <td className="px-3 py-1.5 text-zinc-600">{r.model}</td>
                    <td className="px-3 py-1.5">{MODULE_TH[r.module ?? ""] ?? r.module}</td>
                    <td className="px-3 py-1.5 text-zinc-500">{r.endpoint}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{formatNumber(r.calls)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{formatNumber(r.input_tokens)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{formatNumber(r.output_tokens)}</td>
                    <td className="px-3 py-1.5 text-right font-mono">{formatUsd(r.cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 100 && <p className="text-xs text-zinc-500 mt-2">แสดง 100 แถวแรก · ทั้งหมด {rows.length} แถว</p>}
          </div>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl ring-1 ring-zinc-200 bg-white p-3">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="text-lg font-semibold text-zinc-900">{value}</p>
    </div>
  );
}
