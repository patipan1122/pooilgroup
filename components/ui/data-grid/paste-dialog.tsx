"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, X, Plus, Pencil } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils/cn";
import { mapPastedRows } from "./clipboard";
import type { DataGridColumn } from "./types";

export interface PasteDialogProps<T extends { id: string }> {
  open: boolean;
  onClose: () => void;
  /** Pre-filled paste text (when invoked via Cmd+V) */
  initialText?: string;
  columns: DataGridColumn<T>[];
  /** Existing rows — used to detect updates vs inserts via the `matchKey` */
  existingRows: T[];
  /** Column key used to match incoming rows against existing rows.
   *  e.g. "code" for branches, "email" for users.
   *  If omitted, all rows are treated as inserts. */
  matchKey?: string;
  /** Called with the diff after the user confirms. Parent does the DB write. */
  onConfirm: (diff: {
    inserts: Record<string, string>[];
    updates: Array<{ id: string; before: T; changes: Record<string, string> }>;
  }) => Promise<void> | void;
  title?: string;
}

export function PasteDialog<T extends { id: string }>({
  open,
  onClose,
  initialText = "",
  columns,
  existingRows,
  matchKey,
  onConfirm,
  title = "วางข้อมูลจาก Excel / Sheets",
}: PasteDialogProps<T>) {
  const [text, setText] = useState(initialText);
  const [submitting, setSubmitting] = useState(false);

  // Re-sync local text เมื่อ dialog เปิดใหม่พร้อม initialText ใหม่
  // (สถานะถูก reset ตอนเปิด ไม่ใช่ระหว่าง render)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setText(initialText);
  }, [open, initialText]);

  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    return mapPastedRows<T>(text, columns);
  }, [text, columns]);

  const diff = useMemo(() => {
    if (!parsed) return null;
    const inserts: Record<string, string>[] = [];
    const updates: Array<{
      id: string;
      before: T;
      changes: Record<string, string>;
      changedKeys: string[];
    }> = [];
    const errors: Array<{ idx: number; message: string }> = [];

    const existingByKey = new Map<string, T>();
    if (matchKey) {
      for (const row of existingRows) {
        const v = (row as Record<string, unknown>)[matchKey];
        if (v != null && String(v).trim() !== "") {
          existingByKey.set(String(v).trim().toLowerCase(), row);
        }
      }
    }

    parsed.data.forEach((rec, idx) => {
      // Skip blank rows
      const allEmpty = Object.values(rec).every((v) => !v || !String(v).trim());
      if (allEmpty) return;

      // Validate per-column
      for (const c of columns) {
        if (!c.validate) continue;
        const raw = rec[c.key] ?? "";
        const parsed = c.parse ? c.parse(raw) : raw;
        const err = c.validate(parsed, null);
        if (err) {
          errors.push({ idx, message: `แถว ${idx + 1} · ${c.label}: ${err}` });
        }
      }

      const key = matchKey ? rec[matchKey]?.trim().toLowerCase() : "";
      const existing = key ? existingByKey.get(key) : undefined;
      if (existing) {
        const changes: Record<string, string> = {};
        const changedKeys: string[] = [];
        for (const c of columns) {
          if (!(c.key in rec)) continue;
          const newVal = (rec[c.key] ?? "").trim();
          const oldRaw = (existing as Record<string, unknown>)[c.key];
          const oldVal = oldRaw == null ? "" : String(oldRaw).trim();
          if (newVal !== "" && newVal !== oldVal) {
            changes[c.key] = newVal;
            changedKeys.push(c.key);
          }
        }
        if (changedKeys.length > 0) {
          updates.push({
            id: existing.id,
            before: existing,
            changes,
            changedKeys,
          });
        }
      } else {
        inserts.push(rec);
      }
    });

    return { inserts, updates, errors };
  }, [parsed, columns, existingRows, matchKey]);

  const handleConfirm = async () => {
    if (!diff) return;
    setSubmitting(true);
    try {
      await onConfirm({
        inserts: diff.inserts,
        updates: diff.updates,
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <Dialog open onClose={onClose} title={title}>
      <div className="space-y-4">
        <p className="text-xs text-zinc-500 -mt-1">
          ก๊อปข้อมูลจาก Excel / Google Sheets / Numbers แล้ววางในช่องด้านล่าง
          ระบบจะแยกให้ว่า &ldquo;เพิ่มใหม่&rdquo; กี่แถว / &ldquo;อัพเดท&rdquo; กี่แถว
        </p>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="วางตารางตรงนี้ (Cmd+V)..."
          rows={6}
          className="w-full px-3 py-2 rounded-xl border-2 border-zinc-200 bg-white font-mono text-xs focus:border-[var(--color-brand-500)] focus:outline-none transition-colors resize-y"
          autoFocus
        />

        {diff && (
          <div className="rounded-xl border-2 border-zinc-200 bg-zinc-50/40 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2 bg-white border-b-2 border-zinc-200 flex-wrap">
              <span className="text-xs font-bold text-zinc-700">
                สรุป
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--color-leaf-50)] border border-[var(--color-leaf-200)] text-[var(--color-leaf-800)] text-xs font-bold">
                <Plus className="size-3" />
                เพิ่มใหม่ {diff.inserts.length}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">
                <Pencil className="size-3" />
                อัพเดท {diff.updates.length}
              </span>
              {diff.errors.length > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 border border-red-200 text-red-800 text-xs font-bold">
                  <AlertTriangle className="size-3" />
                  ข้อผิดพลาด {diff.errors.length}
                </span>
              )}
            </div>

            <div className="max-h-72 overflow-auto divide-y divide-zinc-100">
              {diff.inserts.slice(0, 50).map((rec, i) => (
                <DiffRow
                  key={`i${i}`}
                  kind="insert"
                  columns={columns}
                  data={rec}
                />
              ))}
              {diff.updates.slice(0, 50).map((u, i) => (
                <DiffRow
                  key={`u${i}`}
                  kind="update"
                  columns={columns}
                  data={u.changes}
                  before={u.before as Record<string, unknown>}
                />
              ))}
              {diff.inserts.length === 0 && diff.updates.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-zinc-400">
                  ไม่มีข้อมูลที่จะเพิ่ม/แก้ — ตรวจ header ให้ตรงกับชื่อคอลัมน์
                </div>
              )}
            </div>

            {diff.errors.length > 0 && (
              <div className="border-t-2 border-red-200 bg-red-50 max-h-32 overflow-auto">
                {diff.errors.slice(0, 10).map((e, i) => (
                  <div key={i} className="px-4 py-1.5 text-xs text-red-800 flex gap-2">
                    <AlertTriangle className="size-3.5 shrink-0 mt-0.5" />
                    <span>{e.message}</span>
                  </div>
                ))}
                {diff.errors.length > 10 && (
                  <div className="px-4 py-1 text-[11px] text-red-700">
                    + อีก {diff.errors.length - 10} รายการ
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 h-11 rounded-xl border-2 border-zinc-200 bg-white font-bold hover:bg-zinc-50"
          >
            <X className="size-4 inline -mt-0.5" /> ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={
              submitting ||
              !diff ||
              (diff.inserts.length === 0 && diff.updates.length === 0)
            }
            className="flex-1 h-11 rounded-xl bg-[var(--color-brand-600)] text-white font-bold hover:bg-[var(--color-brand-700)] shadow-blue disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          >
            <CheckCircle2 className="size-4" />
            {submitting
              ? "กำลังบันทึก..."
              : `ยืนยัน · ${
                  (diff?.inserts.length ?? 0) + (diff?.updates.length ?? 0)
                } รายการ`}
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function DiffRow<T>({
  kind,
  columns,
  data,
  before,
}: {
  kind: "insert" | "update";
  columns: DataGridColumn<T>[];
  data: Record<string, string>;
  before?: Record<string, unknown>;
}) {
  return (
    <div className="px-4 py-2 text-xs flex items-start gap-3">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold border shrink-0 mt-0.5",
          kind === "insert"
            ? "bg-[var(--color-leaf-50)] border-[var(--color-leaf-200)] text-[var(--color-leaf-800)]"
            : "bg-amber-50 border-amber-200 text-amber-800",
        )}
      >
        {kind === "insert" ? <Plus className="size-2.5" /> : <Pencil className="size-2.5" />}
        {kind === "insert" ? "เพิ่ม" : "แก้"}
      </span>
      <div className="flex-1 flex flex-wrap gap-x-3 gap-y-0.5">
        {columns.map((c) => {
          const val = data[c.key];
          if (kind === "update") {
            if (!val) return null;
            const oldVal = before?.[c.key];
            return (
              <span key={c.key} className="inline-flex items-baseline gap-1">
                <span className="text-zinc-400 text-[10px]">{c.label}:</span>
                <span className="text-zinc-400 line-through">
                  {oldVal == null ? "—" : String(oldVal)}
                </span>
                <span className="text-amber-900 font-bold">→ {val}</span>
              </span>
            );
          }
          return (
            <span key={c.key} className="inline-flex items-baseline gap-1">
              <span className="text-zinc-400 text-[10px]">{c.label}:</span>
              <span className="text-zinc-800 font-medium">{val || "—"}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
