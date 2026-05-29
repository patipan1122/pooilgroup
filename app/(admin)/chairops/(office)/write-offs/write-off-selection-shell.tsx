"use client";

// ChairOps Wave-1 W5 · client wrapper for the write-offs table.
// Owns row-selection state + renders the sticky-bottom bulk-approve bar.
// Modeled on alerts/alert-selection-shell.tsx for visual consistency.
//
// Bulk action targets `bulkApproveWriteOffsAction` (BR3 fast lane <500).
// Server passes pre-shaped row VMs so the client never imports Prisma.

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import {
  MakerCheckerBadge,
  ShortageDriftCell,
} from "@/components/chairops/_kit";
import { bulkApproveWriteOffsAction } from "./actions";

export interface WriteOffRowVM {
  id: string;
  /** Pre-formatted Thai datetime e.g. "12 พ.ค. 69 14:32" */
  thaiDateTime: string;
  thaiRelative: string;
  branchId: string;
  branchName: string;
  amount: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  statusLabel: string;
  statusTone: "danger" | "warning" | "success" | "neutral";
  /** Approval threshold the row triggers — drives action-button tone. */
  requiredRole: "MANAGER" | "CEO";
  makerName: string;
  makerRole: string;
  approverName: string | null;
  approverRole: string | null;
  approverAtLabel: string | null;
  notes: string | null;
  /** Whether the *current* viewer can solo-approve this row. */
  canApprove: boolean;
  /** True when the viewer is the maker (BR7 hard-block on self-approve). */
  isOwnRow: boolean;
  /** Disable reason for the tooltip when canApprove=false. */
  approveDisabledReason: string | null;
  /** True when row is bulk-eligible (PENDING · <500 · viewer can approve · not own). */
  bulkEligible: boolean;
  detailHref: string;
}

export interface WriteOffSelectionShellProps {
  rows: WriteOffRowVM[];
}

export function WriteOffSelectionShell({ rows }: WriteOffSelectionShellProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const bulkIds = useMemo(
    () => rows.filter((r) => r.bulkEligible).map((r) => r.id),
    [rows],
  );
  const allBulkSelected =
    bulkIds.length > 0 && bulkIds.every((id) => selected.has(id));
  const partial = selected.size > 0 && !allBulkSelected;

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected(allBulkSelected ? new Set() : new Set(bulkIds));

  const totalAmount = useMemo(
    () =>
      rows
        .filter((r) => selected.has(r.id))
        .reduce((sum, r) => sum + r.amount, 0),
    [rows, selected],
  );

  const handleBulkApprove = () => {
    if (selected.size === 0) return;
    const fd = new FormData();
    selected.forEach((id) => fd.append("writeOffIds[]", id));
    startTransition(async () => {
      await bulkApproveWriteOffsAction(fd);
      // server redirects → next render fresh
    });
  };

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
        <table className="min-w-[1080px] w-full text-sm">
          <thead className="sticky top-14 z-20 border-b border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-700">
            <tr className="bg-zinc-50 text-left [&>th]:bg-zinc-50">
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label="เลือกทุกแถวที่อนุมัติได้ <500฿"
                  checked={allBulkSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = partial;
                  }}
                  onChange={toggleAll}
                  disabled={bulkIds.length === 0}
                  className="size-4 cursor-pointer rounded border-zinc-400 text-zinc-900 focus:ring-2 focus:ring-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
                />
              </th>
              <th className="px-2 py-2.5">เวลาขอ</th>
              <th className="px-2 py-2.5">สาขา</th>
              <th className="px-2 py-2.5 text-right">จำนวน · เกณฑ์</th>
              <th className="px-2 py-2.5">ผู้สร้าง · ผู้อนุมัติ</th>
              <th className="px-2 py-2.5">เหตุผล</th>
              <th className="px-2 py-2.5">สถานะ</th>
              <th className="px-2 py-2.5 text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-12 text-center text-sm text-zinc-500"
                >
                  ไม่มีรายการตาม filter นี้
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const isChecked = selected.has(r.id);
                const rowBg = isChecked
                  ? "bg-amber-50"
                  : r.status === "PENDING" && r.requiredRole === "CEO"
                    ? "bg-rose-50/40 hover:bg-rose-50"
                    : r.status === "PENDING"
                      ? "bg-amber-50/20 hover:bg-amber-50/60"
                      : "hover:bg-zinc-50";
                return (
                  <tr key={r.id} className={rowBg}>
                    <td className="px-3 py-2 align-top">
                      <input
                        type="checkbox"
                        aria-label={`เลือก write-off ${r.branchName}`}
                        checked={isChecked}
                        onChange={() => r.bulkEligible && toggleOne(r.id)}
                        disabled={!r.bulkEligible}
                        title={
                          r.bulkEligible
                            ? "เลือกเพื่ออนุมัติเป็นชุด"
                            : r.isOwnRow
                              ? "เลือกไม่ได้ — เป็นรายการของคุณเอง"
                              : r.amount >= 500
                                ? "เลือกไม่ได้ — ยอด ≥ 500 ต้อง CEO อนุมัติทีละรายการ"
                                : r.status !== "PENDING"
                                  ? "ปิดไปแล้ว"
                                  : "ไม่มีสิทธิ์อนุมัติ"
                        }
                        className="size-4 cursor-pointer rounded border-zinc-400 text-zinc-900 focus:ring-2 focus:ring-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 align-top text-xs text-zinc-600">
                      <div className="font-medium text-zinc-800">
                        {r.thaiDateTime}
                      </div>
                      <div>{r.thaiRelative}</div>
                    </td>
                    <td className="px-2 py-2 align-top text-sm">
                      <Link
                        href={`/chairops/reconcile/b/${r.branchId}`}
                        className="font-medium text-zinc-900 hover:underline"
                      >
                        {r.branchName}
                      </Link>
                    </td>
                    <td className="px-2 py-2 align-top text-right">
                      <ShortageDriftCell
                        amount={-Math.abs(r.amount)}
                        compact
                        className="justify-end"
                      />
                      <div className="mt-0.5 text-[10px] font-medium tracking-[0.02em] text-zinc-500">
                        {r.requiredRole === "CEO"
                          ? "≥500 · CEO เท่านั้น"
                          : "<500 · MGR ได้"}
                      </div>
                    </td>
                    <td className="px-2 py-2 align-top text-xs">
                      <MakerCheckerBadge
                        compact
                        maker={{
                          name: `${r.makerName} · ${r.makerRole}`,
                        }}
                        approver={
                          r.approverName
                            ? {
                                name: `${r.approverName} · ${r.approverRole ?? ""}`,
                                at: r.approverAtLabel ?? undefined,
                              }
                            : null
                        }
                        noApprover={false}
                      />
                    </td>
                    <td className="max-w-[260px] px-2 py-2 align-top text-xs text-zinc-600">
                      <Link
                        href={r.detailHref}
                        scroll={false}
                        className="line-clamp-2 hover:underline"
                      >
                        {r.reason}
                      </Link>
                      {r.notes && (
                        <div className="mt-0.5 italic text-zinc-500">
                          &ldquo;{r.notes}&rdquo;
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 align-top">
                      <StatusPill tone={r.statusTone} size="xs">
                        {r.statusLabel}
                      </StatusPill>
                    </td>
                    <td className="px-2 py-2 text-right align-top">
                      <Link
                        href={r.detailHref}
                        scroll={false}
                        className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        ดู
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Sticky bulk-action bar — only renders when ≥1 selected. */}
      {selected.size > 0 && (
        <div
          role="region"
          aria-label="แถบอนุมัติหลายรายการ <500 บาท"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.18)]"
        >
          <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <p className="text-sm font-semibold text-zinc-900">
              เลือกแล้ว{" "}
              <span className="tabular-nums">{selected.size}</span> รายการ ·
              รวม{" "}
              <span className="tabular-nums text-rose-700">
                {totalAmount.toLocaleString("en-US")}
              </span>{" "}
              ฿
            </p>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-800"
            >
              ล้างที่เลือก
            </button>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <span className="hidden text-xs text-zinc-500 sm:inline">
                BR3 fast lane · ใช้ MANAGER อนุมัติยอด &lt; 500 ฿ ต่อแถว
              </span>
              <button
                type="button"
                disabled={isPending}
                onClick={handleBulkApprove}
                className="rounded-lg border border-emerald-400 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending
                  ? "กำลังบันทึก..."
                  : `อนุมัติทั้งหมด (${selected.size})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
