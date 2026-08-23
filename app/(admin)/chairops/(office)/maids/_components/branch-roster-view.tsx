// Maid activity table (CEO 2026-08-23) — "ดูตามสาขา", one row PER BRANCH.
//
// CEO 2026-08-23 follow-up: the first version printed one row per maid×branch,
// so a branch covered by several maids (or a maid covering several branches)
// showed the branch name repeated and read as duplicate rows. Now each branch
// is a single row; clicking its name opens a popup (BranchMaidsPopupButton)
// listing every maid who covers it, with her stats and the resign action. The
// row itself shows a quick-glance summary (headcount + freshest "last
// collected") so staleness is still visible without opening every popup.
//
// Active branches with no maid render a red alert row. Closed branches and
// resigned maids sink to the very bottom of the SAME table, muted — visible
// for context (not silently hidden) but out of the way of the active list.
// Read-only server component except for the small client action components
// below.

import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import type { MaidActivityTableRow, MaidStatsForBranch } from "../types";
import { CloseBranchButton, ReopenBranchButton } from "./branch-close-buttons";
import { ReactivateMaidButton } from "./maid-status-buttons";
import { BranchMaidsPopupButton } from "./branch-maids-popup";
import { daysAgoLabel } from "./format";

function freshestCollected(maids: MaidStatsForBranch[]): string | null {
  let best: string | null = null;
  for (const m of maids) {
    if (m.lastCollectedAt && (!best || m.lastCollectedAt > best)) best = m.lastCollectedAt;
  }
  return best;
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
      <table className="w-full min-w-[520px] text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase text-zinc-500">
          <tr>
            <th className="px-4 py-2.5">สาขา</th>
            <th className="px-4 py-2.5 text-right">จัดการ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {rows.length === 0 && (
            <tr>
              <td colSpan={2} className="px-4 py-8 text-center text-zinc-500">
                ไม่มีข้อมูล
              </td>
            </tr>
          )}
          {rows.map((r) => {
            if (r.kind === "no_maid") {
              return (
                <tr key={`empty-${r.branchId}`} className="bg-rose-50/60">
                  <td className="px-4 py-2.5">
                    <div className="font-semibold text-zinc-900">{r.branchName}</div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-sm font-medium text-rose-600">
                      <AlertTriangle className="size-4" aria-hidden />
                      ไม่มีแม่บ้าน — ต้องหาคน
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {canMutate && <CloseBranchButton branchId={r.branchId} branchName={r.branchName} />}
                  </td>
                </tr>
              );
            }
            if (r.kind === "closed_branch") {
              return (
                <tr key={`closed-${r.branchId}`} className="bg-zinc-50 text-zinc-400">
                  <td className="px-4 py-2.5">
                    <div className="font-medium">{r.branchName}</div>
                    <div className="mt-0.5 text-xs">ปิดสาขาแล้ว</div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {canMutate && <ReopenBranchButton branchId={r.branchId} branchName={r.branchName} />}
                  </td>
                </tr>
              );
            }
            if (r.kind === "resigned_maid") {
              return (
                <tr key={`resigned-${r.userId}`} className="bg-zinc-50 text-zinc-400">
                  <td className="px-4 py-2.5">
                    <Link href={`/chairops/maids/${r.userId}`} className="hover:text-zinc-600">
                      {r.displayName}
                    </Link>
                    <span className="ml-1.5">— ลาออกแล้ว</span>
                    <div className="mt-0.5 text-xs">{r.lastBranchName ?? "–"}</div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {canMutate && <ReactivateMaidButton userId={r.userId} displayName={r.displayName} />}
                  </td>
                </tr>
              );
            }
            const freshest = freshestCollected(r.maids);
            return (
              <tr key={`branch-${r.branchId}`} className="hover:bg-zinc-50">
                <td className="px-4 py-2.5">
                  <BranchMaidsPopupButton branchName={r.branchName} maids={r.maids} canMutate={canMutate} />
                  {freshest && (
                    <div className="mt-0.5 text-xs text-zinc-400">เก็บเงินล่าสุด {daysAgoLabel(freshest)}</div>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  {canMutate && r.branchId && <CloseBranchButton branchId={r.branchId} branchName={r.branchName} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
