// Maid activity table (CEO 2026-08-23) — "ดูตามสาขา", one row PER BRANCH.
//
// CEO 2026-08-23: the flat "one row per maid×branch" version printed the
// branch name once per maid (a branch with 2 maids, or a maid covering 2
// branches, looked like duplicate rows). Grouped to one row per branch to
// fix that — but the CEO then asked for the ORIGINAL columns back (name,
// days worked, last collected, avg deposit gap, bank dot, typical times)
// rather than just a headcount summary. Landed on a hybrid: the row shows
// the full stat columns for whichever maid worked MOST RECENTLY there (the
// person the office actually cares about right now), with a "+N คน" badge
// next to her name — click it to open a popup listing everyone else, each
// with the same stats + the resign action. "ปิดสาขา" sits right after the
// branch name, per CEO's explicit placement request.
//
// Active branches with no maid render a red alert row. Closed branches and
// resigned maids sink to the very bottom of the SAME table, muted — visible
// for context (not silently hidden) but out of the way of the active list.

import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import type { MaidActivityTableRow, MaidStatsForBranch } from "../types";
import { CloseBranchButton, ReopenBranchButton } from "./branch-close-buttons";
import { ResignMaidButton, ReactivateMaidButton } from "./maid-status-buttons";
import { BranchMaidsPopupButton } from "./branch-maids-popup";
import { bkkDateTime, daysAgoLabel } from "./format";

// "คนล่าสุดที่ทำงาน" — the maid with the most recent collection at this
// branch; falls back to the primary-sorted first entry if nobody has
// collected here yet (matches sortStats: primary first, then name).
function mostRecentMaid(maids: MaidStatsForBranch[]): MaidStatsForBranch {
  return maids.reduce(
    (best, m) => (m.lastCollectedAt && (!best.lastCollectedAt || m.lastCollectedAt > best.lastCollectedAt) ? m : best),
    maids[0],
  );
}

export function MaidActivityTable({
  rows,
  canMutate,
}: {
  rows: MaidActivityTableRow[];
  canMutate: boolean;
}) {
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
          {rows.map((r) => {
            if (r.kind === "no_maid") {
              return (
                <tr key={`empty-${r.branchId}`} className="bg-rose-50/60">
                  <td className="px-4 py-2.5">
                    <span className="font-semibold text-zinc-900">{r.branchName}</span>
                    {canMutate && <CloseBranchButton branchId={r.branchId} branchName={r.branchName} />}
                  </td>
                  <td colSpan={6} className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-rose-600">
                      <AlertTriangle className="size-4" aria-hidden />
                      ไม่มีแม่บ้าน — ต้องหาคน
                    </span>
                  </td>
                </tr>
              );
            }
            if (r.kind === "closed_branch") {
              return (
                <tr key={`closed-${r.branchId}`} className="bg-zinc-50 text-zinc-400">
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{r.branchName}</span>
                    {canMutate && <ReopenBranchButton branchId={r.branchId} branchName={r.branchName} />}
                  </td>
                  <td colSpan={6} className="px-4 py-2.5">
                    ปิดสาขาแล้ว
                  </td>
                </tr>
              );
            }
            if (r.kind === "resigned_maid") {
              return (
                <tr key={`resigned-${r.userId}`} className="bg-zinc-50 text-zinc-400">
                  <td className="px-4 py-2.5">{r.lastBranchName ?? "–"}</td>
                  <td colSpan={6} className="px-4 py-2.5">
                    <Link href={`/chairops/maids/${r.userId}`} className="hover:text-zinc-600">
                      {r.displayName}
                    </Link>
                    <span className="ml-1.5">— ลาออกแล้ว</span>
                    {canMutate && <ReactivateMaidButton userId={r.userId} displayName={r.displayName} />}
                  </td>
                </tr>
              );
            }

            const featured = mostRecentMaid(r.maids);
            return (
              <tr key={`branch-${r.branchId}`} className="hover:bg-zinc-50">
                <td className="px-4 py-2.5 text-zinc-700">
                  {r.branchName}
                  {canMutate && r.branchId && <CloseBranchButton branchId={r.branchId} branchName={r.branchName} />}
                </td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/chairops/maids/${featured.userId}`}
                    className="font-medium text-zinc-900 hover:text-emerald-700"
                  >
                    {featured.displayName}
                  </Link>
                  {!featured.isPrimary && (
                    <span className="ml-1.5 text-[10px] font-normal text-zinc-400">(สาขาเสริม)</span>
                  )}
                  {r.maids.length > 1 && (
                    <BranchMaidsPopupButton branchName={r.branchName} maids={r.maids} canMutate={canMutate} />
                  )}
                  {canMutate && featured.isPrimary && (
                    <ResignMaidButton userId={featured.userId} displayName={featured.displayName} />
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-zinc-700">
                  {featured.daysWorking === null ? "–" : `${featured.daysWorking} วัน`}
                </td>
                <td className="px-4 py-2.5 text-zinc-700">
                  {featured.lastCollectedAt ? (
                    <>
                      {daysAgoLabel(featured.lastCollectedAt)}
                      <span className="ml-1 text-[11px] text-zinc-400">· {bkkDateTime(featured.lastCollectedAt)}</span>
                    </>
                  ) : (
                    "–"
                  )}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-zinc-700">
                  {featured.avgDepositGapDays === null ? "–" : `ทุก ${featured.avgDepositGapDays.toFixed(1)} วัน`}
                </td>
                <td className="px-3 py-2.5 text-center">
                  <AccountDot ok={featured.hasBankAccount} />
                </td>
                <td className="px-4 py-2.5 text-zinc-700">
                  {featured.typicalTimes.length > 0 ? featured.typicalTimes.join(" · ") : "–"}
                </td>
              </tr>
            );
          })}
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
