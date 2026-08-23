"use client";

// Branch name → popup listing every maid covering it (CEO 2026-08-23 follow-
// up: "ขึ้นแบบสาขาแค่อันเดียว...กด popup ดูแม่บ้านข้างในได้กรณีมีมากกว่าหนึ่ง")
// — replaces printing one table row per maid×branch, which read as the
// branch name repeating/duplicating.

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
  const primary = maids.find((m) => m.isPrimary) ?? maids[0];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-left">
        <span className="font-medium text-zinc-900 hover:text-emerald-700">{branchName}</span>
        <div className="mt-0.5 text-xs text-zinc-500">
          {maids.length} คน · {primary.displayName}
          {maids.length > 1 && ` +${maids.length - 1}`}
        </div>
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
