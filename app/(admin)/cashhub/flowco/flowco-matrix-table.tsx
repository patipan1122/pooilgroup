"use client";

import { useState } from "react";
import { ChevronRight, Sun, Moon, Coins, Fuel } from "lucide-react";
import { Sparkline } from "@/components/cashhub/charts";
import { formatBahtCompact } from "@/lib/utils/format";
import type { FlowcoMatrix, FlowcoMatrixCell } from "@/lib/cashhub/flowco-report";

type Metric = "baht" | "liters";

const TH_M = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

/** ป้ายคอลัมน์แบบสั้น (กันตารางกว้าง) */
function shortLabel(key: string, mode: "day" | "month"): { top: string; sub: string } {
  const p = key.split("-").map(Number);
  if (mode === "month") {
    return { top: TH_M[p[1] - 1] ?? key, sub: String((p[0] + 543) % 100) };
  }
  return { top: String(p[2]), sub: TH_M[p[1] - 1] ?? "" };
}

function litersCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}Ml`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}Kl`;
  return Math.round(n).toLocaleString("th-TH");
}

function cellValue(c: FlowcoMatrixCell | undefined, metric: Metric): number {
  if (!c) return 0;
  return metric === "baht" ? c.baht : c.liters;
}
function fmt(v: number, metric: Metric): string {
  if (v <= 0.5) return "–";
  return metric === "baht" ? formatBahtCompact(v) : litersCompact(v);
}

export function FlowcoMatrixTable({ matrix }: { matrix: FlowcoMatrix }) {
  const [metric, setMetric] = useState<Metric>("baht");
  const [showShift, setShowShift] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const { periodKeys, rows, colTotals, mode, hasShift } = matrix;
  const canShift = mode === "day" && hasShift;
  const lastKey = periodKeys[periodKeys.length - 1];

  const toggleRow = (ste: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(ste)) next.delete(ste);
      else next.add(ste);
      return next;
    });
  };

  const isMuted = (v: number) => v <= 0.5;

  return (
    <div className="space-y-2">
      {/* ── toolbar ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* metric toggle */}
        <div className="inline-flex rounded-xl border border-[var(--ch-border)] p-0.5 bg-white">
          {(["baht", "liters"] as Metric[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMetric(m)}
              className={
                "inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors " +
                (metric === m
                  ? "bg-[var(--ch-brand)] text-white"
                  : "text-[var(--ch-text-2)]")
              }
            >
              {m === "baht" ? <Coins className="size-3.5" /> : <Fuel className="size-3.5" />}
              {m === "baht" ? "ยอดขาย ฿" : "ลิตร"}
            </button>
          ))}
        </div>

        {/* shift split toggle (รายวันเท่านั้น) */}
        {canShift && (
          <button
            type="button"
            onClick={() => setShowShift((v) => !v)}
            className={
              "inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors " +
              (showShift
                ? "border-[var(--ch-brand)] bg-[var(--ch-brand-50,#eef1ff)] text-[var(--ch-brand)]"
                : "border-[var(--ch-border)] text-[var(--ch-text-2)] hover:border-[var(--ch-brand)]")
            }
          >
            <Sun className="size-3.5" />
            {showShift ? "ปิดแยกกะ" : "กดขยายดูแยกกะ (เช้า/ดึก)"}
          </button>
        )}

        <span className="text-[11px] text-[var(--ch-text-2)] ml-auto">
          {mode === "month" ? "รายเดือน" : "รายวัน"} · {periodKeys.length} ช่วง · เลื่อนซ้าย/ขวาดูช่วงเก่า →
        </span>
      </div>

      {/* ── matrix ── */}
      <div className="rounded-2xl border border-[var(--ch-border)] bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-sm border-collapse">
            <thead>
              <tr className="text-[var(--ch-text-2)] text-xs bg-[var(--ch-bg-2)]">
                <th className="px-3 py-2 font-semibold text-left sticky left-0 bg-[var(--ch-bg-2)] z-20 min-w-[180px]">
                  สาขา
                </th>
                {periodKeys.map((k) => {
                  const s = shortLabel(k, mode);
                  const latest = k === lastKey;
                  return (
                    <th
                      key={k}
                      className={
                        "px-2.5 py-2 font-semibold text-right whitespace-nowrap min-w-[64px] " +
                        (latest
                          ? "bg-[var(--ch-brand-50,#eef1ff)] text-[var(--ch-brand)]"
                          : "")
                      }
                    >
                      {s.top}
                      <span className="block text-[9px] font-normal opacity-70">
                        {s.sub}
                      </span>
                    </th>
                  );
                })}
                <th className="px-2 py-2 font-semibold text-center min-w-[76px]">
                  เทรนด์
                </th>
                <th className="px-3 py-2 font-semibold text-right whitespace-nowrap min-w-[84px] bg-[var(--ch-bg-2)] sticky right-0 z-10">
                  รวม
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => {
                const spark = periodKeys.map((k) => ({
                  date: k,
                  value: cellValue(row.cells[k], metric),
                }));
                const rowTotal = metric === "baht" ? row.totalBaht : row.totalLiters;
                const canExpand = showShift && row.hasShiftData;
                const isOpen = expanded.has(row.steId);
                return (
                  <FragmentRow
                    key={row.steId}
                    stripe={ri % 2 === 1}
                    canExpand={canExpand}
                    isOpen={isOpen}
                    onToggle={() => toggleRow(row.steId)}
                    name={row.name}
                    periodKeys={periodKeys}
                    lastKey={lastKey}
                    cells={row.cells}
                    metric={metric}
                    spark={spark}
                    rowTotal={rowTotal}
                    isMuted={isMuted}
                  />
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--ch-border)] font-bold bg-[var(--ch-bg-2)]">
                <td className="px-3 py-2 sticky left-0 bg-[var(--ch-bg-2)] z-20">
                  รวมทุกสาขา
                </td>
                {periodKeys.map((k) => {
                  const v = cellValue(colTotals[k], metric);
                  const latest = k === lastKey;
                  return (
                    <td
                      key={k}
                      className={
                        "px-2.5 py-2 text-right ch-tnum whitespace-nowrap " +
                        (latest ? "bg-[var(--ch-brand-50,#eef1ff)] text-[var(--ch-brand)]" : "")
                      }
                    >
                      {fmt(v, metric)}
                    </td>
                  );
                })}
                <td className="px-2 py-2" />
                <td className="px-3 py-2 text-right ch-tnum whitespace-nowrap bg-[var(--ch-bg-2)] sticky right-0 z-10">
                  {fmt(
                    metric === "baht" ? matrix.grandBaht : matrix.grandLiters,
                    metric,
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-[var(--ch-text-2)] text-center">
        ทุกสาขา (21) · อ่านสด ๆ จาก FlowCo · กรองค่าเพี้ยนแล้ว · ช่องล่าสุดไฮไลต์สีฟ้า ·
        {metric === "baht" ? " ตัวเลข = บาท (M=ล้าน, K=พัน)" : " ตัวเลข = ลิตร (Ml=ล้านลิตร, Kl=พันลิตร)"}
      </p>
    </div>
  );
}

/** แถวสาขา 1 แถว + (ถ้าเปิดแยกกะ) สองแถวย่อย เช้า/ดึก */
function FragmentRow({
  stripe,
  canExpand,
  isOpen,
  onToggle,
  name,
  periodKeys,
  lastKey,
  cells,
  metric,
  spark,
  rowTotal,
  isMuted,
}: {
  stripe: boolean;
  canExpand: boolean;
  isOpen: boolean;
  onToggle: () => void;
  name: string;
  periodKeys: string[];
  lastKey: string | undefined;
  cells: Record<string, FlowcoMatrixCell>;
  metric: Metric;
  spark: { date: string; value: number }[];
  rowTotal: number;
  isMuted: (v: number) => boolean;
}) {
  const bg = stripe ? "bg-[color:rgba(0,0,0,0.015)]" : "bg-white";
  return (
    <>
      <tr className={"border-t border-[var(--ch-border)] " + bg}>
        <td
          className={
            "px-3 py-2 whitespace-nowrap font-medium sticky left-0 z-10 " + bg +
            (canExpand ? " cursor-pointer" : "")
          }
          onClick={canExpand ? onToggle : undefined}
        >
          <span className="inline-flex items-center gap-1">
            {canExpand ? (
              <ChevronRight
                className={
                  "size-3.5 text-[var(--ch-text-2)] transition-transform " +
                  (isOpen ? "rotate-90" : "")
                }
              />
            ) : (
              <span className="inline-block w-3.5" />
            )}
            {name}
          </span>
        </td>
        {periodKeys.map((k) => {
          const v = cellValue(cells[k], metric);
          const latest = k === lastKey;
          return (
            <td
              key={k}
              className={
                "px-2.5 py-2 text-right ch-tnum whitespace-nowrap " +
                (latest ? "bg-[var(--ch-brand-50,#eef1ff)] font-semibold " : "") +
                (isMuted(v) ? "text-[var(--ch-text-2)] opacity-50" : "text-[var(--ch-text)]")
              }
            >
              {fmt(v, metric)}
            </td>
          );
        })}
        <td className="px-2 py-1 text-center">
          <Sparkline data={spark} width={72} height={20} className="inline-block" />
        </td>
        <td
          className={
            "px-3 py-2 text-right ch-tnum font-bold whitespace-nowrap sticky right-0 z-10 " + bg
          }
        >
          {fmt(rowTotal, metric)}
        </td>
      </tr>

      {isOpen && (
        <>
          <ShiftSubRow
            icon="morning"
            label="กะเช้า"
            periodKeys={periodKeys}
            lastKey={lastKey}
            cells={cells}
            metric={metric}
            colSpanEnd
          />
          <ShiftSubRow
            icon="evening"
            label="กะดึก"
            periodKeys={periodKeys}
            lastKey={lastKey}
            cells={cells}
            metric={metric}
            colSpanEnd
          />
        </>
      )}
    </>
  );
}

function ShiftSubRow({
  icon,
  label,
  periodKeys,
  lastKey,
  cells,
  metric,
}: {
  icon: "morning" | "evening";
  label: string;
  periodKeys: string[];
  lastKey: string | undefined;
  cells: Record<string, FlowcoMatrixCell>;
  metric: Metric;
  colSpanEnd?: boolean;
}) {
  const pick = (c: FlowcoMatrixCell | undefined): number => {
    if (!c) return 0;
    if (icon === "morning") return metric === "baht" ? c.mBaht : c.mLit;
    return metric === "baht" ? c.eBaht : c.eLit;
  };
  return (
    <tr className="border-t border-[var(--ch-border)] bg-[var(--ch-brand-50,#eef1ff)]/40">
      <td className="px-3 py-1.5 whitespace-nowrap sticky left-0 z-10 bg-[#f4f6ff]">
        <span className="inline-flex items-center gap-1 pl-5 text-xs text-[var(--ch-text-2)]">
          {icon === "morning" ? (
            <Sun className="size-3 text-amber-500" />
          ) : (
            <Moon className="size-3 text-indigo-400" />
          )}
          {label}
        </span>
      </td>
      {periodKeys.map((k) => {
        const v = pick(cells[k]);
        const latest = k === lastKey;
        return (
          <td
            key={k}
            className={
              "px-2.5 py-1.5 text-right ch-tnum text-xs whitespace-nowrap text-[var(--ch-text-2)] " +
              (latest ? "bg-[var(--ch-brand-50,#eef1ff)] " : "")
            }
          >
            {fmt(v, metric)}
          </td>
        );
      })}
      <td className="px-2 py-1.5 bg-[#f4f6ff]" />
      <td className="px-3 py-1.5 bg-[#f4f6ff] sticky right-0 z-10" />
    </tr>
  );
}
