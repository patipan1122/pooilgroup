"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Calendar, Store, Table2, LayoutList } from "lucide-react";

type Mode = "day" | "month" | "shift";
type View = "table" | "matrix";

export function FlowcoReportFilters({
  branches,
  from,
  to,
  ste,
  mode,
  view = "table",
}: {
  branches: { steId: number; name: string }[];
  from: string;
  to: string;
  ste: number | null;
  mode: Mode;
  view?: View;
}) {
  const router = useRouter();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const [s, setS] = useState<string>(ste != null ? String(ste) : "");

  function go(next: {
    from?: string;
    to?: string;
    ste?: string;
    mode?: Mode;
    view?: View;
  }) {
    const params = new URLSearchParams();
    params.set("from", next.from ?? f);
    params.set("to", next.to ?? t);
    const nextView = next.view ?? view;
    // matrix ไม่รองรับ "รายกะ" (แยกกะเป็นปุ่มในตาราง) — บังคับ day
    let nextMode = next.mode ?? mode;
    if (nextView === "matrix" && nextMode === "shift") nextMode = "day";
    params.set("mode", nextMode);
    if (nextView === "matrix") params.set("view", "matrix");
    const steVal = next.ste !== undefined ? next.ste : s;
    if (steVal && nextView !== "matrix") params.set("ste", steVal);
    router.push(`/cashhub/flowco?${params.toString()}`);
  }

  const isMatrix = view === "matrix";

  return (
    <div className="rounded-2xl border border-[var(--ch-border)] bg-white p-3 flex flex-col gap-2 animate-fade-up">
      {/* ── report-type toggle: ตารางรายการ vs สรุปทุกสาขา ── */}
      <div className="inline-flex rounded-xl border border-[var(--ch-border)] p-0.5 self-start bg-[var(--ch-bg-2)]">
        <button
          type="button"
          onClick={() => go({ view: "table" })}
          className={
            "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors " +
            (!isMatrix ? "bg-white text-[var(--ch-brand)] shadow-sm" : "text-[var(--ch-text-2)]")
          }
        >
          <LayoutList className="size-3.5" /> รายการรายวัน
        </button>
        <button
          type="button"
          onClick={() => go({ view: "matrix" })}
          className={
            "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-colors " +
            (isMatrix ? "bg-white text-[var(--ch-brand)] shadow-sm" : "text-[var(--ch-text-2)]")
          }
        >
          <Table2 className="size-3.5" /> 📊 สรุปทุกสาขา
        </button>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
        {!isMatrix && (
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
        )}

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

      {/* mode toggle — matrix ตัด "รายกะ" ออก (แยกกะเป็นปุ่มในตาราง) */}
      <div className="inline-flex rounded-xl border border-[var(--ch-border)] p-0.5 self-start">
        {((isMatrix ? ["day", "month"] : ["day", "month", "shift"]) as Mode[]).map(
          (m) => (
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
              {m === "day" ? "รายวัน" : m === "month" ? "รายเดือน" : "รายกะ"}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
