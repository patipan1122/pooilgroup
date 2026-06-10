"use client";

// "ถาม AI" — lightweight web Q&A over the period aggregates. Optional companion
// to the insights panel; same budget guard server-side (askLedgerQa).
import { useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
import { askLedgerQa } from "../../_ai-actions";

const SUGGESTIONS = [
  "หมวดไหนใช้เงินมากสุดเดือนนี้",
  "สาขาไหนค่าใช้จ่ายสูงสุด",
  "มีหมวดไหนใกล้เกินงบบ้าง",
];

export function QaBox({
  companyId,
  branchId,
  period,
}: {
  companyId: string;
  branchId?: string | null;
  period: string;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function ask(q: string) {
    const text = q.trim();
    if (!text || pending) return;
    setError(null);
    startTransition(async () => {
      const res = await askLedgerQa({ companyId, branchId, period, question: text });
      if (res.ok) {
        setAnswer(res.answer);
      } else {
        setError(res.error);
        setAnswer(null);
      }
    });
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-xl bg-zinc-100 text-zinc-600">
          <MessageCircle className="size-4" aria-hidden />
        </span>
        <h2 className="text-sm font-bold text-zinc-800">ถาม AI เรื่องค่าใช้จ่าย</h2>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="เช่น เดือนนี้ค่าน้ำมันเท่าไหร่"
          maxLength={500}
          className="min-w-0 flex-1 rounded-xl border border-zinc-300 px-3 py-2 text-base outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)] sm:text-sm"
        />
        <button
          type="submit"
          disabled={pending || question.trim().length < 2}
          className="press shrink-0 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "กำลังถาม…" : "ถาม"}
        </button>
      </form>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setQuestion(s);
              ask(s);
            }}
            disabled={pending}
            className="press rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-200 disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {pending && (
          <div className="space-y-2" aria-hidden>
            <div className="h-3 w-full animate-pulse rounded bg-zinc-100" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-zinc-100" />
          </div>
        )}
        {!pending && error && (
          <p className="animate-fade-in rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        {!pending && !error && answer && (
          <div className="animate-fade-in whitespace-pre-wrap rounded-xl bg-zinc-50 p-3 text-sm leading-relaxed text-zinc-700">
            {answer}
          </div>
        )}
      </div>
    </div>
  );
}
