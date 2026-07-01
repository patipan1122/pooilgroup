"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Calendar, Store } from "lucide-react";

type Mode = "day" | "month";

export function FlowcoReportFilters({
  branches,
  from,
  to,
  ste,
  mode,
}: {
  branches: { steId: number; name: string }[];
  from: string;
  to: string;
  ste: number | null;
  mode: Mode;
}) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const [s, setS] = useState<string>(ste != null ? String(ste) : "");

  function go(next: { from?: string; to?: string; ste?: string; mode?: Mode }) {
    const params = new URLSearchParams();
    params.set("from", next.from ?? f);
    params.set("to", next.to ?? t);
    params.set("mode", next.mode ?? mode);
    const steVal = next.ste !== undefined ? next.ste : s;
    if (steVal) params.set("ste", steVal);
    router.push(`/cashhub/flowco?${params.toString()}`);
  }

  return (
    <div className="rounded-2xl border border-[var(--ch-border)] bg-white p-3 flex flex-col gap-2 animate-fade-up">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
        <label className="text-xs text-[var(--ch-text-2)] flex-1">
          <span className="flex items-center gap-1 mb-1">
            <Store className="size-3" /> สาขา
          </span>
          <select
            value={s}
            onChange={(e) => {
              setS(e.target.value);
              go({ ste: e.target.value });
            }}
            className="w-full rounded-xl border border-[var(--ch-border)] px-3 py-2 text-sm text-[var(--ch-text)] bg-white"
          >
            <option value="">ทุกสาขา ({branches.length})</option>
            {branches.map((b) => (
              <option key={b.steId} value={b.steId}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs text-[var(--ch-text-2)]">
          <span className="flex items-center gap-1 mb-1">
            <Calendar className="size-3" /> ตั้งแต่
          </span>
          <input
            type="date"
            value={f}
            onChange={(e) => setF(e.target.value)}
            onBlur={() => go({})}
            className="w-full rounded-xl border border-[var(--ch-border)] px-3 py-2 text-sm text-[var(--ch-text)]"
          />
        </label>
        <label className="text-xs text-[var(--ch-text-2)]">
          <span className="mb-1 block">ถึง</span>
          <input
            type="date"
            value={t}
            onChange={(e) => setT(e.target.value)}
            onBlur={() => go({})}
            className="w-full rounded-xl border border-[var(--ch-border)] px-3 py-2 text-sm text-[var(--ch-text)]"
          />
        </label>
      </div>

      {/* mode toggle */}
      <div className="inline-flex rounded-xl border border-[var(--ch-border)] p-0.5 self-start">
        {(["day", "month"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => go({ mode: m })}
            className={
              "px-4 py-1.5 rounded-lg text-sm font-semibold transition-colors " +
              (mode === m
                ? "bg-[var(--ch-brand)] text-white"
                : "text-[var(--ch-text-2)]")
            }
          >
            {m === "day" ? "รายวัน" : "รายเดือน"}
          </button>
        ))}
      </div>
    </div>
  );
}
