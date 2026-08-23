"use client";

// "+N คน" badge → popup listing every maid covering a branch (CEO 2026-08-23:
// the row already shows the most-recently-active maid's full stats inline;
// this badge is just the escape hatch to see/manage everyone else covering
// the same branch — each with the same stats + the resign action).

import { useState } from "react";
import Link from "next/link";
import { Dialog } from "@/components/ui/dialog";
import type { MaidStatsForBranch } from "../types";
import { bkkDateTime, daysAgoLabel } from "./format";
import { ResignMaidButton } from "./maid-status-buttons";

export function BranchMaidsPopupButton({
  branchName,
  maids,
  canMutate,
}: {
  branchName: string;
  maids: MaidStatsForBranch[];
  canMutate: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-1.5 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[10px] font-semibold text-emerald-700"
      >
        {maids.length} คน
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title={branchName}>
        <div className="divide-y divide-zinc-100">
          {maids.map((m) => (
            <div key={m.userId} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <Link
                  href={`/chairops/maids/${m.userId}`}
                  className="font-medium text-zinc-900 hover:text-emerald-700"
                >
                  {m.displayName}
                  {!m.isPrimary && <span className="ml-1.5 text-[11px] font-normal text-zinc-400">(สาขาเสริม)</span>}
                </Link>
                <span
                  className={"inline-block size-2.5 shrink-0 rounded-full " + (m.hasBankAccount ? "bg-emerald-500" : "bg-zinc-900")}
                  aria-label={m.hasBankAccount ? "มีเลขบัญชีแล้ว" : "ยังไม่กรอกเลขบัญชี"}
                />
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                ทำงานมาแล้ว {m.daysWorking === null ? "–" : `${m.daysWorking} วัน`} · เก็บเงินล่าสุด{" "}
                {m.lastCollectedAt ? (
                  <>
                    {daysAgoLabel(m.lastCollectedAt)} ({bkkDateTime(m.lastCollectedAt)})
                  </>
                ) : (
                  "–"
                )}
              </div>
              <div className="mt-0.5 text-xs text-zinc-500">
                เฉลี่ยฝากเงิน{m.avgDepositGapDays === null ? " –" : ` ทุก ${m.avgDepositGapDays.toFixed(1)} วัน`} ·
                เวลาที่มักเก็บ/ฝาก {m.typicalTimes.length > 0 ? m.typicalTimes.join(" · ") : "–"}
              </div>
              {canMutate && m.isPrimary && (
                <div className="mt-1.5">
                  <ResignMaidButton userId={m.userId} displayName={m.displayName} />
                </div>
              )}
            </div>
          ))}
        </div>
      </Dialog>
    </>
  );
}
