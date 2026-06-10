"use client";

// "AI วิเคราะห์ธุรกิจ" panel — calls the generateInsights server action on demand
// (not on page load, to respect the AI budget). Loading / empty / error states.
import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { generateInsights } from "../../_ai-actions";

export function InsightsPanel({
  companyId,
  branchId,
  period,
}: {
  companyId: string;
  branchId?: string | null;
  period: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const res = await generateInsights({ companyId, branchId, period });
      if (res.ok) {
        setText(res.text);
      } else {
        setError(res.error);
        setText(null);
      }
    });
  }

  return (
    <div className="rounded-2xl border border-[var(--color-brand-100)] bg-[var(--color-brand-50)]/40 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[var(--color-brand-100)] text-[var(--color-brand-700)]">
            <Sparkles className="size-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-zinc-800">AI วิเคราะห์ธุรกิจ</h2>
            <p className="text-xs text-zinc-500">
              สรุปค่าใช้จ่าย + จุดน่าสังเกต + ข้อแนะนำ (งวด {period})
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="shrink-0 rounded-xl bg-[var(--color-brand-600)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[var(--color-brand-700)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "กำลังวิเคราะห์…" : text ? "วิเคราะห์อีกครั้ง" : "เริ่มวิเคราะห์"}
        </button>
      </div>

      <div className="mt-3">
        {pending && (
          <div className="space-y-2" aria-hidden>
            <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-200" />
            <div className="h-3 w-full animate-pulse rounded bg-zinc-200" />
            <div className="h-3 w-5/6 animate-pulse rounded bg-zinc-200" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-zinc-200" />
          </div>
        )}

        {!pending && error && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        )}

        {!pending && !error && text && (
          <div className="whitespace-pre-wrap rounded-xl bg-white/70 p-3 text-sm leading-relaxed text-zinc-700 ring-1 ring-zinc-100">
            {text}
          </div>
        )}

        {!pending && !error && !text && (
          <p className="py-2 text-sm text-zinc-400">
            กดปุ่ม “เริ่มวิเคราะห์” เพื่อให้ AI สรุปค่าใช้จ่ายเดือนนี้ให้
          </p>
        )}
      </div>
    </div>
  );
}
