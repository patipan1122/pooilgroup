"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { X, Sparkles, ArrowRight, Loader2 } from "lucide-react";
import {
  STATUS_LABELS,
  type ApplicationStatus,
} from "@/lib/recruit/types";
import { changeApplicationStatus } from "@/lib/recruit/actions";
import { scoreApplicationAction } from "@/app/(admin)/recruit/_actions/ai";

// Cap AI-score batch to protect token budget + avoid long-running client loops.
const AI_SCORE_CAP = 20;
// Rough baht estimate per AI score (for the cost-confirm dialog only).
const AI_COST_PER_SCORE = 2;

// Statuses HR can move a batch into (subset — the common bulk moves).
const BULK_MOVE_STATUSES: ApplicationStatus[] = ["SCREENING", "REJECTED"];

interface Props {
  /** ids currently selected across all columns */
  selectedIds: string[];
  /** clear the whole selection */
  onClear: () => void;
}

/**
 * Sticky bulk-action bar — appears only when ≥1 card is selected.
 * RULE I: all loops run CLIENT-SIDE, one item at a time (await in sequence),
 * calling the EXISTING single-item server actions. No server-side batch → no
 * Vercel timeout. Partial-failure safe (try/catch per item), idempotent
 * (running flag disables buttons), and refreshes the server list at the end.
 */
export function BulkActionBar({ selectedIds, onClear }: Props) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(
    null,
  );

  const count = selectedIds.length;

  async function runAiScore() {
    if (running || count === 0) return;

    // Cap 20 — process only the first N; tell HR the rest carry over.
    let ids = selectedIds;
    if (ids.length > AI_SCORE_CAP) {
      ids = ids.slice(0, AI_SCORE_CAP);
      toast.message("ประเมินได้ทีละ 20 คน · ที่เหลือเลือกใหม่รอบหน้า");
    }
    const n = ids.length;

    // Cost confirm — AI score costs money, so ask before spending.
    const ok = window.confirm(
      `จะให้ AI ประเมิน ${n} คน · ใช้ AI ${n} ครั้ง (~฿${n * AI_COST_PER_SCORE}) ยืนยันไหม?`,
    );
    if (!ok) return;

    setRunning(true);
    const failures: { id: string; error: string }[] = [];
    for (let i = 0; i < n; i++) {
      setProgress({ label: "กำลังประเมิน", done: i, total: n });
      try {
        await scoreApplicationAction(ids[i]);
      } catch (e) {
        failures.push({ id: ids[i], error: (e as Error).message });
      }
    }
    setProgress(null);
    setRunning(false);

    const okCount = n - failures.length;
    if (failures.length === 0) {
      toast.success(`ประเมินสำเร็จ ${okCount} คน`);
    } else {
      toast.error(`สำเร็จ ${okCount} · ล้มเหลว ${failures.length}`);
    }
    onClear();
    router.refresh();
  }

  async function runStatusMove(next: ApplicationStatus) {
    if (running || count === 0) return;

    const ids = selectedIds;
    const n = ids.length;

    // Bulk status change sends a real status email per candidate (Resend).
    // Confirm first — REJECTED is irreversible + emotionally consequential, so
    // spell that out. (Prevents a stray phone tap rejecting a whole selection.)
    const confirmMsg =
      next === "REJECTED"
        ? `ยืนยันย้าย ${n} คนไป "${STATUS_LABELS[next]}"?\nระบบจะส่งอีเมลแจ้ง "ไม่ผ่าน" ให้ผู้สมัครทุกคนทันที · ย้อนกลับไม่ได้`
        : `ยืนยันย้าย ${n} คนไป "${STATUS_LABELS[next]}"?\nระบบจะส่งอีเมลแจ้งผลให้ผู้สมัครที่มีอีเมล`;
    if (!window.confirm(confirmMsg)) return;

    setRunning(true);
    const failures: { id: string; error: string }[] = [];
    for (let i = 0; i < n; i++) {
      setProgress({ label: `กำลังย้ายไป "${STATUS_LABELS[next]}"`, done: i, total: n });
      try {
        await changeApplicationStatus(ids[i], next);
      } catch (e) {
        failures.push({ id: ids[i], error: (e as Error).message });
      }
    }
    setProgress(null);
    setRunning(false);

    const okCount = n - failures.length;
    if (failures.length === 0) {
      toast.success(`ย้าย ${okCount} คนไป "${STATUS_LABELS[next]}"`);
    } else {
      toast.error(`สำเร็จ ${okCount} · ล้มเหลว ${failures.length}`);
    }
    onClear();
    router.refresh();
  }

  if (count === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-50 lg:sticky lg:bottom-4 lg:mx-4 lg:mb-4 lg:inset-x-auto">
      <div className="mx-auto max-w-3xl border-t border-zinc-200 bg-white/95 backdrop-blur px-3 py-2.5 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] lg:rounded-2xl lg:border lg:shadow-lg">
        {progress ? (
          <div className="flex items-center gap-2 py-1">
            <Loader2 className="size-4 animate-spin text-[var(--color-brand-600)]" />
            <span className="text-sm font-bold text-zinc-800">
              {progress.label} {progress.done + 1}/{progress.total}…
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {/* Selection count + clear */}
            <div className="flex items-center gap-2 mr-1">
              <span className="inline-flex items-center justify-center h-7 min-w-7 px-2 rounded-full bg-[var(--color-brand-600)] text-white text-xs font-extrabold tabular-num">
                {count}
              </span>
              <button
                type="button"
                onClick={onClear}
                disabled={running}
                className="inline-flex items-center gap-1 h-9 px-2.5 rounded-lg text-xs font-bold text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
              >
                <X className="size-3.5" />
                ยกเลิกเลือก
              </button>
            </div>

            <div className="h-6 w-px bg-zinc-200 hidden sm:block" />

            {/* AI score */}
            <button
              type="button"
              onClick={runAiScore}
              disabled={running}
              className="inline-flex items-center gap-1.5 h-10 px-3 rounded-xl bg-[var(--color-brand-600)] text-white text-xs font-bold hover:bg-[var(--color-brand-700)] disabled:opacity-50"
            >
              <Sparkles className="size-4" />
              ให้ AI ประเมินทั้งหมด
            </button>

            {/* Status moves */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {BULK_MOVE_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => runStatusMove(s)}
                  disabled={running}
                  className="inline-flex items-center gap-1 h-10 px-3 rounded-xl border border-zinc-200 bg-white text-xs font-bold text-zinc-700 hover:border-[var(--color-brand-400)] hover:text-[var(--color-brand-700)] disabled:opacity-50"
                >
                  <ArrowRight className="size-3.5" />
                  ย้ายไป {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
