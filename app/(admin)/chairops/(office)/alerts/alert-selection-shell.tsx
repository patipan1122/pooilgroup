"use client";

// AlertSelectionShell · client wrapper that owns row-selection state and renders
// the sticky-bottom bulk action bar. Server passes already-formatted row data
// (avoids leaking Prisma types to the client + keeps bundle small).
//
// Bulk actions hit the server actions in `app/(admin)/chairops/alerts/actions.ts`
// (bulkAckAlertsAction / bulkResolveAlertsAction). Form submits selected IDs as
// repeated `alertIds[]` fields.

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { StatusPill } from "@/components/ui/status-pill";
import {
  bulkAckAlertsAction,
  bulkResolveAlertsAction,
} from "@/app/(admin)/chairops/alerts/actions";

export interface AlertRowVM {
  id: string;
  createdAt: string;
  thaiDateTime: string;
  thaiRelative: string;
  level: string;
  severityTier: "P0" | "P1" | "P2";
  severityTone: "danger" | "warning" | "neutral";
  kind: string;
  kindLabel: string;
  branchName: string | null;
  branchCode: string | null;
  branchId: string | null;
  title: string;
  message: string;
  status: string;
  statusLabel: string;
  statusTone: "danger" | "warning" | "success" | "neutral";
  ackedByName: string | null;
  detailHref: string;
  ackAvailable: boolean;
  resolveAvailable: boolean;
}

export interface AlertSelectionShellProps {
  rows: AlertRowVM[];
}

export function AlertSelectionShell({ rows }: AlertSelectionShellProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const allSelectableIds = useMemo(
    () => rows.filter((r) => r.ackAvailable || r.resolveAvailable).map((r) => r.id),
    [rows],
  );

  const allSelected = allSelectableIds.length > 0 && allSelectableIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(allSelectableIds));
  };

  const handleBulk = (
    actionFn: typeof bulkAckAlertsAction | typeof bulkResolveAlertsAction,
    reason?: string,
  ) => {
    if (selected.size === 0) return;
    const fd = new FormData();
    selected.forEach((id) => fd.append("alertIds[]", id));
    if (reason) fd.set("reason", reason);
    startTransition(async () => {
      await actionFn(fd);
      // server action redirects → revalidatePath clears the selection on next render.
    });
  };

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white [scrollbar-width:thin] [scrollbar-color:rgb(212_212_216)_transparent] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-300 [&::-webkit-scrollbar-track]:bg-transparent">
        <table className="min-w-[880px] w-full text-sm">
          <thead className="sticky top-14 z-20 border-b border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-700 shadow-[0_1px_0_rgb(228_228_231)]">
            <tr className="bg-zinc-50 text-left [&>th]:bg-zinc-50">
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label="เลือกทั้งหมด"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  className="size-4 cursor-pointer rounded border-zinc-400 text-zinc-900 focus:ring-2 focus:ring-zinc-900"
                />
              </th>
              <th className="px-2 py-2.5">เวลา</th>
              <th className="px-2 py-2.5">ระดับ</th>
              <th className="px-2 py-2.5">ประเภท</th>
              <th className="px-2 py-2.5">สาขา</th>
              <th className="px-2 py-2.5">หัวข้อ + รายละเอียด</th>
              <th className="px-2 py-2.5">สถานะ</th>
              <th className="px-2 py-2.5 text-right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-12 text-center text-sm text-zinc-500">
                  ไม่มี alert ตาม filter นี้ · เงียบสนิท
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const isSelectable = r.ackAvailable || r.resolveAvailable;
                const isChecked = selected.has(r.id);
                const rowBg = isChecked
                  ? "bg-amber-50"
                  : r.severityTier === "P0"
                    ? "bg-rose-50/40 hover:bg-rose-50"
                    : r.severityTier === "P1"
                      ? "bg-amber-50/30 hover:bg-amber-50/60"
                      : "hover:bg-zinc-50";
                return (
                  <tr key={r.id} className={rowBg}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`เลือก alert ${r.title}`}
                        checked={isChecked}
                        onChange={() => isSelectable && toggleOne(r.id)}
                        disabled={!isSelectable}
                        className="size-4 cursor-pointer rounded border-zinc-400 text-zinc-900 focus:ring-2 focus:ring-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
                      />
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-xs text-zinc-600">
                      <div className="font-medium text-zinc-800">{r.thaiDateTime}</div>
                      <div>{r.thaiRelative}</div>
                    </td>
                    <td className="px-2 py-2">
                      <StatusPill tone={r.severityTone} size="xs" dot>
                        {r.severityTier}
                      </StatusPill>
                    </td>
                    <td className="px-2 py-2">
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-zinc-700">
                        {r.kindLabel}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {r.branchId && r.branchName ? (
                        <Link
                          href={`/chairops/reconcile/${r.branchId}`}
                          className="font-medium text-zinc-800 hover:underline"
                        >
                          {r.branchName}
                        </Link>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="max-w-[420px] px-2 py-2">
                      <Link
                        href={r.detailHref}
                        className="block font-medium text-zinc-900 hover:underline"
                        scroll={false}
                      >
                        {r.title}
                      </Link>
                      <div className="text-xs text-zinc-600">{r.message}</div>
                    </td>
                    <td className="px-2 py-2">
                      <StatusPill tone={r.statusTone} size="xs">
                        {r.statusLabel}
                      </StatusPill>
                      {r.ackedByName && (
                        <div className="mt-0.5 text-[10px] text-zinc-500">
                          โดย {r.ackedByName}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <Link
                        href={r.detailHref}
                        className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                        scroll={false}
                      >
                        ดูรายละเอียด
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Sticky bulk action bar — shows when ≥1 row selected. */}
      {selected.size > 0 && (
        <div
          role="region"
          aria-label="แถบทำงานหลายรายการ"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 bg-white shadow-[0_-8px_24px_-12px_rgba(0,0,0,0.18)]"
        >
          <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <p className="text-sm font-semibold text-zinc-900">
              เลือกแล้ว <span className="tabular-nums">{selected.size}</span> รายการ
            </p>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-xs font-medium text-zinc-500 hover:text-zinc-800"
            >
              ล้างที่เลือก
            </button>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleBulk(bulkAckAlertsAction)}
                className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isPending ? "กำลังบันทึก..." : `รับทราบ (${selected.size})`}
              </button>
              <BulkResolveButton
                disabled={isPending}
                count={selected.size}
                onConfirm={(reason) => handleBulk(bulkResolveAlertsAction, reason)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function BulkResolveButton({
  disabled,
  count,
  onConfirm,
}: {
  disabled: boolean;
  count: number;
  onConfirm: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");

  // Escape key dismiss (B7 / B-007 regression). Does NOT reset reason —
  // backdrop click likewise preserves the typed reason (B26).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const handleSubmit = () => {
    onConfirm(reason.trim());
    setOpen(false);
    setReason("");
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="rounded-lg border border-emerald-400 bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        ปิด ({count})
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="ยืนยันการปิด alert จำนวนมาก"
          className="fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/30 backdrop-blur-sm sm:items-center"
        >
          <div className="w-full max-w-md rounded-t-2xl border border-zinc-200 bg-white p-5 shadow-xl sm:rounded-2xl">
            <h2 className="text-lg font-bold text-zinc-900">
              ยืนยันปิด alert {count} รายการ
            </h2>
            <p className="mt-1 text-sm text-zinc-600">
              ระบบจะบันทึก audit log + ตั้งสถานะเป็น <strong>ปิด</strong>{" "}
              และผู้ใช้คนอื่นจะเห็นทันที
            </p>
            <label className="mt-4 block text-xs font-semibold text-zinc-700">
              เหตุผล (ถ้ามี · ไม่บังคับ)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="เช่น ตรวจสอบกับสาขาแล้ว · เป็น false positive"
              className="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-2 text-sm focus:border-zinc-500 focus:outline-none focus:ring-2 focus:ring-zinc-300"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                ยืนยันปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
