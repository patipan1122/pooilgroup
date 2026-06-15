"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { getFuelSheetMonth, type FuelSheetMonthData } from "./actions";

export interface FuelMonthMeta {
  period_key: string;
  label: string;
  days_present: number;
  expected_days: number;
  missing_days: number[];
  ncol: number;
}

// freeze-pane geometry (px) — frozen columns get EXACT widths so the sticky `left`
// offsets line up perfectly (no skew); the 2-row header uses an exact group-row height.
const DATE_W = 96;
const SHIFT_W = 58;
const GROUP_H = 26;

const fmtCell = (v: number | string | null) => {
  if (v == null || v === "") return "·";
  if (typeof v === "number")
    return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return String(v);
};

function groupClass(g: string): string {
  if (g.includes("กสิกร")) return "bg-emerald-500/12 text-emerald-800";
  if (g.includes("TTB-YM")) return "bg-sky-500/12 text-sky-800";
  if (g.includes("609")) return "bg-amber-500/12 text-amber-800";
  return "";
}

export function FuelSheetView({ months }: { months: FuelMonthMeta[] }) {
  const [idx, setIdx] = useState(0);
  const [data, setData] = useState<FuelSheetMonthData | null>(null);
  const [loading, setLoading] = useState(false);
  const cache = useRef<Map<string, FuelSheetMonthData>>(new Map());

  const meta = months[idx];

  useEffect(() => {
    if (!meta) return;
    const key = meta.period_key;
    const cached = cache.current.get(key);
    if (cached) {
      setData(cached);
      return;
    }
    let active = true;
    setLoading(true);
    getFuelSheetMonth(key)
      .then((d) => {
        if (!active) return;
        if (d) cache.current.set(key, d);
        setData(d);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [meta]);

  if (months.length === 0) {
    return (
      <div className="rounded-2xl border border-[var(--ch-border)] bg-[var(--ch-bg-2)] p-8 text-center text-[var(--ch-text-2)]">
        ยังไม่มีตารางเต็ม — กด “นำเข้า/อัปเดตยอด” เพื่อดึงจากชีต
      </div>
    );
  }

  // build merged group-header spans
  const groupSpans: { group: string; span: number }[] = [];
  if (data) {
    for (let i = 0; i < data.headers.length; ) {
      let j = i;
      while (j + 1 < data.headers.length && data.headers[j + 1]!.group === data.headers[i]!.group) j++;
      groupSpans.push({ group: data.headers[i]!.group, span: j - i + 1 });
      i = j + 1;
    }
  }

  const noGap = meta && meta.missing_days.length === 0;

  return (
    <div className="flex flex-col gap-3">
      {/* controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIdx((i) => Math.min(months.length - 1, i + 1))}
            disabled={idx >= months.length - 1}
            className="grid size-9 place-items-center rounded-lg border border-[var(--ch-border)] bg-white text-[var(--ch-text)] disabled:opacity-40 hover:border-[var(--ch-brand)]"
            aria-label="เดือนก่อนหน้า"
          >
            <ChevronLeft className="size-4" />
          </button>
          <select
            value={idx}
            onChange={(e) => setIdx(Number(e.target.value))}
            className="rounded-lg border border-[var(--ch-border)] bg-white px-3 py-2 text-sm font-semibold text-[var(--ch-text)]"
          >
            {months.map((m, i) => (
              <option key={m.period_key} value={i}>
                {m.label} ({m.ncol} คอลัมน์)
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={idx <= 0}
            className="grid size-9 place-items-center rounded-lg border border-[var(--ch-border)] bg-white text-[var(--ch-text)] disabled:opacity-40 hover:border-[var(--ch-brand)]"
            aria-label="เดือนถัดไป"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
        {meta && (
          <span
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold ${
              noGap
                ? "bg-[var(--ch-ok)]/15 text-[var(--ch-ok)]"
                : "bg-amber-500/15 text-amber-700"
            }`}
          >
            {noGap ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
            วัน {meta.days_present}/{meta.expected_days}
            {noGap ? " · ครบทุกวัน" : ` · ขาดวัน ${meta.missing_days.join(",")}`}
          </span>
        )}
        {data && (
          <span className="text-xs text-[var(--ch-text-2)]">
            {data.rows.length} แถว · {data.headers.length} คอลัมน์ (เหมือนชีตจริง)
          </span>
        )}
      </div>

      {/* legend */}
      <div className="text-[11px] text-[var(--ch-text-2)]">
        <span className="rounded px-1.5 py-0.5 bg-emerald-500/15 text-emerald-800">กสิกร K+</span>{" "}
        <span className="rounded px-1.5 py-0.5 bg-sky-500/15 text-sky-800">TTB-YM 0649</span>{" "}
        <span className="rounded px-1.5 py-0.5 bg-amber-500/15 text-amber-800">ทหารไทย 609</span>{" "}
        · เลขแดง = ค่าติดลบ · เลื่อนแนวนอนดูครบทุกคอลัมน์ (วันที่/กะ ตรึงไว้)
      </div>

      {/* table */}
      <div className="relative overflow-auto rounded-xl border border-[var(--ch-border)] max-h-[72vh] bg-white">
        {loading && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-white/60">
            <Loader2 className="size-6 animate-spin text-[var(--ch-brand)]" />
          </div>
        )}
        {data && (
          <table className="border-separate border-spacing-0 text-[11.5px] tabular-nums whitespace-nowrap">
            <thead>
              <tr>
                {/* frozen corner (date) — top+left, highest layer */}
                <th
                  rowSpan={2}
                  style={{ left: 0, width: DATE_W, minWidth: DATE_W, maxWidth: DATE_W }}
                  className="sticky top-0 z-40 bg-[var(--ch-bg-2)] border-b border-r border-[var(--ch-border)] px-2 text-left text-[10.5px] font-semibold text-[var(--ch-text-2)]"
                >
                  วันที่
                </th>
                <th
                  rowSpan={2}
                  style={{ left: DATE_W, width: SHIFT_W, minWidth: SHIFT_W, maxWidth: SHIFT_W }}
                  className="sticky top-0 z-40 bg-[var(--ch-bg-2)] border-b border-r border-[var(--ch-border)] px-2 text-left text-[10.5px] font-semibold text-[var(--ch-text-2)]"
                >
                  กะ
                </th>
                {groupSpans.map((g, i) => (
                  <th
                    key={i}
                    colSpan={g.span}
                    style={{ top: 0, height: GROUP_H }}
                    className={`sticky z-30 border-b border-r border-[var(--ch-border)] px-2 text-center text-[10.5px] font-semibold ${
                      g.group ? groupClass(g.group) : "bg-[var(--ch-bg-2)] text-[var(--ch-text-2)]"
                    }`}
                  >
                    {g.group || ""}
                  </th>
                ))}
              </tr>
              <tr>
                {data.headers.map((h, i) => (
                  <th
                    key={i}
                    style={{ top: GROUP_H }}
                    className={`sticky z-30 border-b border-r border-[var(--ch-border)] px-2 py-1 text-right text-[10px] font-semibold text-[var(--ch-text-2)] ${
                      h.group ? groupClass(h.group) : "bg-[var(--ch-bg-2)]"
                    }`}
                  >
                    {h.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, ri) => {
                const rowBg = ri % 2 === 1 ? "bg-[var(--ch-bg-2)]" : "bg-white";
                return (
                  <tr key={ri}>
                    <td
                      style={{ left: 0, width: DATE_W, minWidth: DATE_W, maxWidth: DATE_W }}
                      className={`sticky z-20 ${rowBg} border-b border-r border-[var(--ch-border)] px-2 py-1 text-left text-[var(--ch-text)]`}
                    >
                      {r.date}
                    </td>
                    <td
                      style={{ left: DATE_W, width: SHIFT_W, minWidth: SHIFT_W, maxWidth: SHIFT_W }}
                      className={`sticky z-20 ${rowBg} border-b border-r border-[var(--ch-border)] px-2 py-1 text-left font-semibold text-[var(--ch-text)]`}
                    >
                      {r.shift}
                    </td>
                    {data.headers.map((_, ci) => {
                      const v = r.cells[ci] ?? null;
                      const neg = typeof v === "number" && v < 0;
                      const txt = typeof v === "string";
                      return (
                        <td
                          key={ci}
                          className={`${rowBg} border-b border-r border-[var(--ch-border)] px-2 py-1 ${
                            txt ? "text-left text-[var(--ch-text-2)]" : "text-right"
                          } ${neg ? "text-[var(--ch-danger)]" : "text-[var(--ch-text)]"}`}
                        >
                          {fmtCell(v)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
