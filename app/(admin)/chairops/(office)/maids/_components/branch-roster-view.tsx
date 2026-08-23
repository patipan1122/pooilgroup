// Maid activity table (CEO 2026-08-23) — "ดูตามสาขา", one row per maid.
//
// Replaces the earlier branch-card grid with a table so the whole roster is
// scannable at once: branch, name, how long they've worked (from their first
// deposit ever), last collection, average days between deposits, whether a
// payout bank account is on file, and the 1-2 times of day they most often
// handle cash (gap-clustered — NOT a flat average, which would blend a
// morning + evening round into a meaningless noon reading). Branches with no
// maid still render a row so gaps in coverage stay visible. Read-only server
// component — clicking a maid opens /chairops/maids/[userId].

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import type { MaidActivityTableRow } from "../types";

function bkkDateTime(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function MaidActivityTable({ rows }: { rows: MaidActivityTableRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
      {/* legend written out (not a hover title) — CEO checks this on mobile, no hover there */}
      <div className="flex items-center gap-1.5 border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500">
        <span className="inline-block size-2 rounded-full bg-emerald-500" aria-hidden /> มีเลขบัญชีแล้ว
        <span className="ml-2 inline-block size-2 rounded-full bg-zinc-900" aria-hidden /> ยังไม่กรอกบัญชี
      </div>
      <table className="w-full min-w-[860px] text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-4 py-2.5">สาขา</th>
            <th className="px-4 py-2.5">ชื่อ</th>
            <th className="px-3 py-2.5 text-right">ทำงานมาแล้ว</th>
            <th className="px-4 py-2.5">เก็บเงินล่าสุด</th>
            <th className="px-3 py-2.5 text-right">เฉลี่ยฝากเงิน</th>
            <th className="px-3 py-2.5 text-center">บัญชี</th>
            <th className="px-4 py-2.5">เวลาที่มักเก็บ/ฝาก</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
                ไม่มีข้อมูล
              </td>
            </tr>
          )}
          {rows.map((r) =>
            r.kind === "no_maid" ? (
              <tr key={`empty-${r.branchId}`} className="bg-rose-50/60">
                <td className="px-4 py-2.5 font-semibold text-zinc-900">{r.branchName}</td>
                <td colSpan={6} className="px-4 py-2.5">
                  <span className="inline-flex items-center gap-1.5 text-sm font-medium text-rose-600">
                    <AlertTriangle className="size-4" aria-hidden />
                    ไม่มีแม่บ้าน — ต้องหาคน
                  </span>
                </td>
              </tr>
            ) : (
              <tr key={r.userId} className="hover:bg-zinc-50">
                <td className="px-4 py-2.5 text-zinc-700">
                  {r.branchName}
                  {r.branchExtraCount > 0 && (
                    <span className="ml-1.5 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[10px] font-semibold text-emerald-700">
                      +{r.branchExtraCount} สาขา
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/chairops/maids/${r.userId}`}
                    className="font-medium text-zinc-900 hover:text-emerald-700"
                  >
                    {r.displayName}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-zinc-700">
                  {r.daysWorking === null ? "–" : `${r.daysWorking} วัน`}
                </td>
                <td className="px-4 py-2.5 text-zinc-700">
                  {r.lastCollectedAt ? bkkDateTime(r.lastCollectedAt) : "–"}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-zinc-700">
                  {r.avgDepositGapDays === null ? "–" : `ทุก ${r.avgDepositGapDays.toFixed(1)} วัน`}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <AccountDot ok={r.hasBankAccount} />
                </td>
                <td className="px-4 py-2.5 text-zinc-700">
                  {r.typicalTimes.length > 0 ? r.typicalTimes.join(" · ") : "–"}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

// Color-only marker per CEO 2026-08-23 — เขียว = กรอกเลขบัญชีแล้ว · ดำ = ยังไม่กรอก.
// Meaning is spelled out in the legend above the table (not a hover title —
// per [[feedback-ceo-mobile-primary-no-hover-ui-2026-08-15]] CEO checks on
// mobile, where title tooltips never show).
function AccountDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={"mx-auto inline-block size-2.5 rounded-full " + (ok ? "bg-emerald-500" : "bg-zinc-900")}
      aria-label={ok ? "มีเลขบัญชีแล้ว" : "ยังไม่กรอกเลขบัญชี"}
    />
  );
}
