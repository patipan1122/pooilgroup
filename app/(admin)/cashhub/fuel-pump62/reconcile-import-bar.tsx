"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { promoteMonthsToReconcile } from "./actions";
import type { FuelMonthMeta } from "./fuel-sheet-view";

export function ReconcileImportBar({ months }: { months: FuelMonthMeta[] }) {
  const router = useRouter();
  const [sel, setSel] = useState(months[0]?.period_key ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (months.length === 0) return null;

  function run(keys: string[]) {
    setMsg(null);
    start(async () => {
      const r = await promoteMonthsToReconcile(keys);
      if (r.ok) {
        setMsg({ ok: true, text: `ดึงเข้ากระทบยอดแล้ว ${r.totalRows} แถว — ${r.imported?.map((i) => i.label).join(", ")}` });
        router.refresh();
      } else {
        setMsg({ ok: false, text: r.error ?? "ดึงไม่สำเร็จ" });
      }
    });
  }

  const btn =
    "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--ch-border)] bg-[var(--ch-bg-2)] px-3 py-2.5">
      <span className="text-xs font-semibold text-[var(--ch-text)]">เลือกเดือนดึงเข้ากระทบยอด:</span>
      <select
        value={sel}
        onChange={(e) => setSel(e.target.value)}
        disabled={pending}
        className="rounded-lg border border-[var(--ch-border)] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--ch-text)]"
      >
        {months.map((m) => (
          <option key={m.period_key} value={m.period_key}>
            {m.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={pending || !sel}
        onClick={() => run([sel])}
        className={`${btn} bg-[var(--ch-brand)] text-white`}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
        ดึงเดือนนี้
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => run(months.map((m) => m.period_key))}
        className={`${btn} border border-[var(--ch-border)] bg-white text-[var(--ch-text)] hover:border-[var(--ch-brand)]`}
      >
        ดึงทุกเดือน ({months.length})
      </button>
      {msg && (
        <span
          className={`inline-flex items-center gap-1 text-xs font-medium ${
            msg.ok ? "text-[var(--ch-ok)]" : "text-[var(--ch-danger)]"
          }`}
        >
          {msg.ok ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
          {msg.text}
        </span>
      )}
    </div>
  );
}
