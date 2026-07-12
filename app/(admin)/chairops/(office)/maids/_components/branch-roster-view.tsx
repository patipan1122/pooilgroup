// Branch-first maid roster (CEO 2026-07-12) — "ดูตามสาขา".
//
// One card per active branch → the maids covering it, each with their full
// today-status (ทำงาน/ลา + เก็บเงิน/ฝาก/ทำความสะอาดวันนี้). Branches with no
// maid render a red "ไม่มีแม่บ้าน" banner. Active maids with no branch at all
// are listed at the bottom so nothing is hidden. Read-only server component —
// clicking a maid opens /chairops/maids/[userId].

import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  Coffee,
  Wallet,
  Landmark,
  Sparkles,
  UserX,
} from "lucide-react";

import type { BranchRosterView, MaidInBranch } from "../types";

function bkkTime(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function BranchRosterViewGrid({ view }: { view: BranchRosterView }) {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {view.branches.map((b) => (
          <div
            key={b.branchId}
            className={
              "rounded-xl border bg-white shadow-sm " +
              (b.maids.length === 0 ? "border-rose-200" : "border-zinc-200")
            }
          >
            <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <Building2 className="size-4 shrink-0 text-zinc-400" aria-hidden />
                <span className="truncate font-semibold text-zinc-900">{b.branchName}</span>
              </div>
              <span className="shrink-0 text-xs text-zinc-400">
                {b.maids.length > 0 ? `${b.maids.length} คน` : ""}
              </span>
            </div>

            <div className="divide-y divide-zinc-100">
              {b.maids.length === 0 ? (
                <div className="flex items-center gap-2 px-4 py-4 text-sm font-medium text-rose-600">
                  <AlertTriangle className="size-4" aria-hidden />
                  ไม่มีแม่บ้าน — ต้องหาคน
                </div>
              ) : (
                b.maids.map((m) => <MaidLine key={m.userId} m={m} />)
              )}
            </div>
          </div>
        ))}
      </div>

      {view.unassignedMaids.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-800">
            <UserX className="size-4" aria-hidden />
            แม่บ้านที่ยังไม่ผูกสาขา · {view.unassignedMaids.length} คน
          </div>
          <div className="flex flex-wrap gap-2">
            {view.unassignedMaids.map((u) => (
              <Link
                key={u.userId}
                href={`/chairops/maids/${u.userId}`}
                className="inline-flex items-center rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
              >
                {u.displayName}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function MaidLine({ m }: { m: MaidInBranch }) {
  return (
    <div className="px-4 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/chairops/maids/${m.userId}`}
          className="min-w-0 truncate font-medium text-zinc-900 hover:text-emerald-700"
        >
          {m.displayName}
          {!m.isPrimary && (
            <span className="ml-1.5 text-[10px] font-normal text-zinc-400">(สาขาเสริม)</span>
          )}
        </Link>
        {m.onLeave ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800">
            <Coffee className="size-3" aria-hidden />
            ลาวันนี้{m.leaveReason ? ` · ${m.leaveReason}` : ""}
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-800">
            ทำงาน
          </span>
        )}
      </div>

      {/* today's activity — muted when not yet done, so the office can see gaps */}
      {!m.onLeave && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          <ActivityChip
            done={m.collectedCount > 0}
            icon={<Wallet className="size-3" aria-hidden />}
            doneLabel={
              m.collectedCount > 1
                ? `เก็บเงิน ${m.collectedCount} รอบ · ${m.collectedLastAt ? bkkTime(m.collectedLastAt) : ""}`
                : `เก็บเงินแล้ว${m.collectedLastAt ? ` ${bkkTime(m.collectedLastAt)}` : ""}`
            }
            pendingLabel="ยังไม่เก็บเงิน"
          />
          <ActivityChip
            done={m.deposited}
            icon={<Landmark className="size-3" aria-hidden />}
            doneLabel="ฝากแล้ว"
            pendingLabel="ยังไม่ฝาก"
          />
          <ActivityChip
            done={m.cleaned}
            icon={<Sparkles className="size-3" aria-hidden />}
            doneLabel="ทำความสะอาดแล้ว"
            pendingLabel="ยังไม่ทำความสะอาด"
          />
        </div>
      )}
    </div>
  );
}

function ActivityChip({
  done,
  icon,
  doneLabel,
  pendingLabel,
}: {
  done: boolean;
  icon: React.ReactNode;
  doneLabel: string;
  pendingLabel: string;
}) {
  return (
    <span
      className={
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 " +
        (done
          ? "bg-emerald-50 text-emerald-700"
          : "bg-zinc-50 text-zinc-400")
      }
    >
      {icon}
      {done ? doneLabel : pendingLabel}
    </span>
  );
}
