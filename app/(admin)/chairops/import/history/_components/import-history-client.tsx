"use client";

// CSV import history — interactive delete / restore island (CEO 2026-06-30).
// The page is a server component; this client island holds the expand state and
// fires the soft-delete / restore server actions, then refreshes the route.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Trash2,
  RotateCcw,
  Paperclip,
  AlertTriangle,
} from "lucide-react";
import type { CsvImportBatch } from "@/lib/chairops/queries/import-history";
import { softDeleteCollections, restoreCollections } from "../actions";

function baht(n: number) {
  return n.toLocaleString("en-US");
}

export function ImportHistoryClient({
  batches,
  canDelete,
}: {
  batches: CsvImportBatch[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  function run(
    key: string,
    fn: () => Promise<{ ok: boolean; count?: number; error?: string }>,
    okText: (n: number) => string,
  ) {
    setBusyKey(key);
    setMsg(null);
    startTransition(async () => {
      try {
        const res = await fn();
        if (res.ok) {
          setMsg({ kind: "ok", text: okText(res.count ?? 0) });
          router.refresh();
        } else {
          setMsg({ kind: "err", text: res.error ?? "ทำรายการไม่สำเร็จ" });
        }
      } catch {
        setMsg({ kind: "err", text: "เกิดข้อผิดพลาด · ลองใหม่อีกครั้ง" });
      } finally {
        setBusyKey(null);
      }
    });
  }

  function deleteBatch(b: CsvImportBatch) {
    const warn =
      `ลบการนำเข้านี้ ${b.rowCount} แถว · ${baht(b.totalAmount)} ฿?` +
      (b.hasDeposited
        ? "\n\n⚠️ มีบางแถวฝากเข้าธนาคารแล้ว — ตรวจให้แน่ใจก่อนลบ"
        : "") +
      "\n\n(ลบแบบซ่อน · เรียกคืนได้ภายหลัง · ยอดขาด-เกินจะคิดใหม่ทันที)";
    if (!window.confirm(warn)) return;
    const reason = window.prompt("เหตุผลที่ลบ (ไม่บังคับ):", "") ?? undefined;
    run(
      b.key,
      () => softDeleteCollections({ collectionIds: b.activeIds, reason }),
      (n) => `ลบแล้ว ${n} แถว · ยอดคิดใหม่เรียบร้อย`,
    );
  }

  function restoreBatch(b: CsvImportBatch) {
    if (!window.confirm(`เรียกคืนการนำเข้านี้ ${b.deletedRowCount} แถวกลับมา?`))
      return;
    run(
      b.key,
      () => restoreCollections({ collectionIds: b.deletedIds }),
      (n) => `เรียกคืนแล้ว ${n} แถว`,
    );
  }

  function deleteRow(b: CsvImportBatch, id: string, amount: number) {
    if (!window.confirm(`ลบแถวนี้ (${baht(amount)} ฿)?`)) return;
    run(
      `${b.key}:${id}`,
      () => softDeleteCollections({ collectionIds: [id] }),
      () => "ลบแถวแล้ว",
    );
  }
  function restoreRow(b: CsvImportBatch, id: string) {
    run(
      `${b.key}:${id}`,
      () => restoreCollections({ collectionIds: [id] }),
      () => "เรียกคืนแถวแล้ว",
    );
  }

  if (batches.length === 0) {
    return (
      <p className="rounded-lg border border-zinc-200 bg-white p-8 text-center text-sm text-zinc-500">
        ยังไม่มีการนำเข้า CSV
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {msg && (
        <div
          className={
            "rounded-lg border px-3 py-2 text-sm " +
            (msg.kind === "ok"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800")
          }
        >
          {msg.text}
        </div>
      )}

      {batches.map((b) => {
        const isOpen = !!open[b.key];
        const busy = pending && (busyKey === b.key || busyKey?.startsWith(`${b.key}:`));
        const statusBadge =
          b.status === "deleted" ? (
            <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-medium text-zinc-600">
              ลบแล้วทั้งชุด
            </span>
          ) : b.status === "partial" ? (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
              ลบบางส่วน ({b.deletedRowCount})
            </span>
          ) : (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800">
              ใช้งานอยู่
            </span>
          );

        return (
          <div
            key={b.key}
            className={
              "rounded-xl border bg-white " +
              (b.status === "deleted"
                ? "border-zinc-200 opacity-75"
                : "border-zinc-200")
            }
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3">
              <button
                type="button"
                onClick={() => setOpen((s) => ({ ...s, [b.key]: !s[b.key] }))}
                className="inline-flex items-center gap-1 text-left"
                aria-label="กางดูรายการในชุดนี้"
              >
                {isOpen ? (
                  <ChevronDown className="size-4 text-zinc-400" />
                ) : (
                  <ChevronRight className="size-4 text-zinc-400" />
                )}
                <span className="font-mono text-sm font-semibold text-zinc-800">
                  {b.importedAt}
                </span>
              </button>
              <span className="text-sm text-zinc-600">
                โดย {b.importedByName}
              </span>
              <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">
                {b.branchLabel}
              </span>
              {!b.isRealBatch && (
                <span
                  className="text-[11px] text-zinc-400"
                  title="นำเข้าก่อนระบบจับกลุ่ม · จัดกลุ่มตามคน+วัน"
                >
                  (ชุดเก่า)
                </span>
              )}
              <span className="ml-auto text-sm">
                <strong className="text-zinc-900">{b.rowCount}</strong>
                <span className="text-zinc-500"> แถว · </span>
                <strong className="font-mono text-zinc-900">
                  {baht(b.totalAmount)} ฿
                </strong>
              </span>
              {statusBadge}
              {canDelete && (
                <div className="flex gap-2">
                  {b.activeIds.length > 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => deleteBatch(b)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" /> ลบทั้งชุด
                    </button>
                  )}
                  {b.deletedIds.length > 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => restoreBatch(b)}
                      className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 disabled:opacity-50"
                    >
                      <RotateCcw className="size-3.5" /> เรียกคืน
                    </button>
                  )}
                </div>
              )}
            </div>

            {b.status !== "active" && b.deletedByName && (
              <div className="flex items-center gap-1 border-t border-zinc-100 px-3 py-1.5 text-[11px] text-zinc-500">
                <AlertTriangle className="size-3" /> ลบโดย {b.deletedByName}
                {b.deletedAt ? ` · ${b.deletedAt}` : ""}
                {b.deleteReason ? ` · "${b.deleteReason}"` : ""}
              </div>
            )}

            {isOpen && (
              <div className="overflow-x-auto border-t border-zinc-100">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-zinc-500">
                      <th className="px-3 py-1.5 font-medium">เวลาเก็บ</th>
                      <th className="px-3 py-1.5 font-medium">สาขา</th>
                      <th className="px-3 py-1.5 text-right font-medium">ยอด</th>
                      <th className="px-3 py-1.5 font-medium">ที่มา</th>
                      <th className="px-3 py-1.5 font-medium">สลิป</th>
                      {canDelete && <th className="px-3 py-1.5"></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r) => (
                      <tr
                        key={r.id}
                        className={
                          "border-t border-zinc-50 " +
                          (r.deleted ? "bg-zinc-50 text-zinc-400 line-through" : "")
                        }
                      >
                        <td className="px-3 py-1.5 font-mono text-xs">
                          {r.collectedAt}
                        </td>
                        <td className="px-3 py-1.5">{r.branchName}</td>
                        <td className="px-3 py-1.5 text-right font-mono">
                          {baht(r.countedAmount)}
                        </td>
                        <td className="px-3 py-1.5 text-xs">
                          {r.source === "OFFICE_PROXY" ? "🏢 ออฟฟิศเก็บ" : "📥 CSV"}
                          {r.deposited && (
                            <span className="ml-1 text-[10px] text-emerald-600">
                              ฝากแล้ว
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-1.5">
                          {r.hasSlip ? (
                            <Paperclip className="size-3.5 text-zinc-500" />
                          ) : (
                            <span className="text-xs text-zinc-300">—</span>
                          )}
                        </td>
                        {canDelete && (
                          <td className="px-3 py-1.5 text-right">
                            {r.deleted ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => restoreRow(b, r.id)}
                                className="text-xs font-medium text-sky-600 hover:underline disabled:opacity-50"
                              >
                                เรียกคืน
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => deleteRow(b, r.id, r.countedAmount)}
                                className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                              >
                                ลบ
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
