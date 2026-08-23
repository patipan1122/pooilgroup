// Maid activity table (CEO 2026-08-23) — "ดูตามสาขา", one row per maid×branch.
//
// Replaces the earlier branch-card grid with a table so the whole roster is
// scannable at once: branch, name, how long they've worked (from their first
// deposit ever), last collection at THIS branch, average days between
// deposits at THIS branch, whether a payout bank account is on file, and the
// 1-2 times of day they most often handle cash overall (gap-clustered — NOT a
// flat average, which would blend a morning + evening round into a
// meaningless noon reading). A maid covering multiple branches gets one row
// per branch she actively covers, tagged "(สาขาเสริม)" where she isn't
// primary.
//
// Active branches with no maid render a red alert row. Closed branches and
// resigned maids sink to the very bottom of the SAME table, muted — visible
// for context (not silently hidden) but out of the way of the active list.
// Read-only server component except for the two small client action buttons
// below — clicking a maid's name opens /chairops/maids/[userId].

import Link from "next/link";
import { AlertTriangle } from "lucide-react";

import type { MaidActivityTableRow } from "../types";
import { CloseBranchButton, ReopenBranchButton } from "./branch-close-buttons";
import { ResignMaidButton, ReactivateMaidButton } from "./maid-status-buttons";

function bkkDateTime(iso: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function bkkYmd(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// CEO 2026-08-23 follow-up: "เพิ่ม column เก็บเงินล่าสุดกี่วันที่แล้ว" — the
// headline signal office staff scan for is "how stale is this", not the exact
// timestamp (kept alongside, smaller, for reference).
function daysAgoLabel(iso: string): string {
  const then = new Date(iso);
  const todayStart = new Date(`${bkkYmd(new Date())}T00:00:00+07:00`);
  const thenStart = new Date(`${bkkYmd(then)}T00:00:00+07:00`);
  const diffDays = Math.round((todayStart.getTime() - thenStart.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return "วันนี้";
  if (diffDays === 1) return "เมื่อวาน";
  return `${diffDays} วันที่แล้ว`;
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
                  <td className="px-4 py-2.5 font-semibold text-zinc-900">{r.branchName}</td>
                  <td colSpan={6} className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-rose-600">
                      <AlertTriangle className="size-4" aria-hidden />
                      ไม่มีแม่บ้าน — ต้องหาคน
                    </span>
                    {canMutate && <CloseBranchButton branchId={r.branchId} branchName={r.branchName} />}
                  </td>
                </tr>
              );
            }
            if (r.kind === "closed_branch") {
              return (
                <tr key={`closed-${r.branchId}`} className="bg-zinc-50 text-zinc-400">
                  <td className="px-4 py-2.5 font-medium">{r.branchName}</td>
                  <td colSpan={6} className="px-4 py-2.5">
                    ปิดสาขาแล้ว
                    {canMutate && <ReopenBranchButton branchId={r.branchId} branchName={r.branchName} />}
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
            return (
              <tr key={`${r.branchId}-${r.userId}`} className="hover:bg-zinc-50">
                <td className="px-4 py-2.5 text-zinc-700">
                  {r.branchName}
                  {!r.isPrimary && (
                    <span className="ml-1.5 text-[10px] font-normal text-zinc-400">(สาขาเสริม)</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/chairops/maids/${r.userId}`}
                    className="font-medium text-zinc-900 hover:text-emerald-700"
                  >
                    {r.displayName}
                  </Link>
                  {canMutate && r.isPrimary && <ResignMaidButton userId={r.userId} displayName={r.displayName} />}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-zinc-700">
                  {r.daysWorking === null ? "–" : `${r.daysWorking} วัน`}
                </td>
                <td className="px-4 py-2.5 text-zinc-700">
                  {r.lastCollectedAt ? (
                    <>
                      {daysAgoLabel(r.lastCollectedAt)}
                      <span className="ml-1 text-[11px] text-zinc-400">· {bkkDateTime(r.lastCollectedAt)}</span>
                    </>
                  ) : (
                    "–"
                  )}
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
