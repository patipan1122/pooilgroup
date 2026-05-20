"use client";

import { useState, useTransition } from "react";
import { Bot, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { scoreApplicationAction } from "@/app/(admin)/recruit/_actions/ai";

interface Props {
  applicationId: string;
  aiScore: number | null;
  aiSummary: string | null;
  aiStrengths: string[] | null;
  aiRisks: string[] | null;
  aiEvaluatedAt: Date | null;
  canWrite: boolean;
}

export function ApplicationAIPanel({
  applicationId,
  aiScore: initialScore,
  aiSummary: initialSummary,
  aiStrengths: initialStrengths,
  aiRisks: initialRisks,
  aiEvaluatedAt: initialEvalAt,
  canWrite,
}: Props) {
  const [score, setScore] = useState(initialScore);
  const [summary, setSummary] = useState(initialSummary);
  const [strengths, setStrengths] = useState(initialStrengths);
  const [risks, setRisks] = useState(initialRisks);
  const [evaluatedAt, setEvaluatedAt] = useState(initialEvalAt);
  const [isPending, startTransition] = useTransition();

  function runEval() {
    startTransition(async () => {
      try {
        const result = await scoreApplicationAction(applicationId);
        setScore(result.score);
        setSummary(result.summary);
        setStrengths(result.strengths);
        setRisks(result.risks);
        setEvaluatedAt(new Date());
        toast.success(`AI ประเมินเสร็จ · คะแนน ${result.score}`);
      } catch (e) {
        toast.error("AI ประเมินไม่สำเร็จ: " + (e as Error).message);
      }
    });
  }

  // Not yet evaluated
  if (score == null && !isPending) {
    return (
      <div className="mt-4 rounded-2xl border-2 border-dashed border-[var(--color-brand-200)] bg-gradient-to-br from-[var(--color-brand-50)]/40 to-white p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-[var(--color-brand-600)]" />
            <p className="font-bold text-zinc-900 text-sm">
              AI ยังไม่ประเมินผู้สมัครคนนี้
            </p>
          </div>
          {canWrite && (
            <button
              type="button"
              onClick={runEval}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-[var(--color-brand-600)] px-3 py-2 rounded-lg hover:bg-[var(--color-brand-700)] transition-colors"
            >
              <Bot className="size-4" />
              ประเมินด้วย AI
            </button>
          )}
        </div>
        <p className="text-xs text-zinc-500 mt-2">
          AI จะอ่านคำตอบ + JD แล้วให้คะแนน 0-100 พร้อมเหตุผล (ไม่ดูภาพ/อายุ/เพศ)
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-[var(--color-brand-200)] bg-gradient-to-br from-[var(--color-brand-50)]/60 to-white p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <Bot className="size-5 text-[var(--color-brand-700)]" />
          <p className="font-bold text-zinc-900 text-sm">ผู้ช่วย AI ประเมินแล้ว</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-4xl font-extrabold text-[var(--color-brand-700)] tabular-num">
            {isPending ? "..." : score}
            <span className="text-base font-medium text-zinc-400 ml-1">/100</span>
          </span>
          {canWrite && (
            <button
              type="button"
              onClick={runEval}
              disabled={isPending}
              className="text-zinc-400 hover:text-[var(--color-brand-700)]"
              title="ประเมินใหม่"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {summary && (
        <p className="text-sm text-zinc-700 leading-relaxed mb-3">{summary}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {strengths && strengths.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-green-700 mb-1.5">
              ✓ จุดแข็ง
            </p>
            <ul className="space-y-1">
              {strengths.map((s, i) => (
                <li key={i} className="text-xs text-zinc-700 leading-relaxed">
                  • {s}
                </li>
              ))}
            </ul>
          </div>
        )}
        {risks && risks.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] font-bold text-amber-700 mb-1.5">
              ⚠ จุดเสี่ยง
            </p>
            <ul className="space-y-1">
              {risks.map((s, i) => (
                <li key={i} className="text-xs text-zinc-700 leading-relaxed">
                  • {s}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {evaluatedAt && (
        <p className="text-[10px] text-zinc-400 mt-3">
          ประเมินเมื่อ {new Date(evaluatedAt).toLocaleString("th-TH")} · AI advisory only
        </p>
      )}
    </div>
  );
}
