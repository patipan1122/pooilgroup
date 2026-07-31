"use client";

import { useState, Fragment } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Table, X, Calendar, ChevronRight, FileText, Clock, CheckCircle2, ArrowLeftRight } from "lucide-react";
import { formatBaht, BILL_STATUS, PAYMENT_METHODS } from "@/lib/rentspace/format";
import type { MatrixUnit, MatrixCell } from "@/lib/rentspace/matrix-data";

/** YYYY-MM-DD → "5 มิ.ย. 69" (Thai short, BE 2-digit) */
function fmtThaiDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  const beShort = (y + 543) % 100;
  return `${d} ${["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."][m - 1]} ${beShort}`;
}

const TH_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
];

type Props = {
  year: number;
  view: "year" | "month";
  month: number; // 1..12
  units: MatrixUnit[];
  cells: Record<string, MatrixCell>;
  monthsTotals: number[];
};

function pad2(m: number) {
  return String(m).padStart(2, "0");
}

function statusTone(status: string): { bg: string; color: string } {
  const t = BILL_STATUS[status];
  if (!t) return { bg: "transparent", color: "var(--rs-text)" };
  return { bg: t.soft, color: t.color };
}

export default function MatrixGrid({ year, view, month, units, cells, monthsTotals }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const beYear = year + 543;
  const [active, setActive] = useState<{ unit: MatrixUnit; cell: MatrixCell | null; month: number } | null>(null);

  function setView(next: "year" | "month") {
    const sp = new URLSearchParams(params.toString());
    sp.set("view", next);
    sp.set("year", String(year));
    sp.set("month", String(month));
    router.push(`/rentspace/matrix?${sp.toString()}`);
  }

  function setMonth(m: number) {
    const sp = new URLSearchParams(params.toString());
    sp.set("view", "month");
    sp.set("year", String(year));
    sp.set("month", String(m));
    router.push(`/rentspace/matrix?${sp.toString()}`);
  }

  function openCell(unit: MatrixUnit, m: number) {
    const cell = cells[`${unit.id}|${year}-${pad2(m)}`] ?? null;
    setActive({ unit, cell, month: m });
  }

  // year-view per-room totals
  function roomYearTotal(unitId: string): number {
    let sum = 0;
    for (let m = 1; m <= 12; m++) {
      const c = cells[`${unitId}|${year}-${pad2(m)}`];
      if (c) sum += c.total;
    }
    return sum;
  }
  const grandYearTotal = monthsTotals.reduce((a, b) => a + b, 0);

  // expandable month columns (show ค่าเช่า/น้ำ/ไฟ inline) + electric-outlier flag
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  function toggleExp(m: number) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(m)) n.delete(m);
      else n.add(m);
      return n;
    });
  }
  function monthElecAvg(m: number): number {
    let sum = 0, count = 0;
    for (const u of units) {
      const c = cells[`${u.id}|${year}-${pad2(m)}`];
      if (c && c.electric > 0) { sum += c.electric; count++; }
    }
    return count ? sum / count : 0;
  }
  function monthSub(m: number, pick: (c: MatrixCell) => number): number {
    let sum = 0;
    for (const u of units) {
      const c = cells[`${u.id}|${year}-${pad2(m)}`];
      if (c) sum += pick(c);
    }
    return sum;
  }

  return (
    <div className="rs-matrix min-w-0">
      {/* view + month toggles — single non-wrapping row; the month chips
          scroll horizontally instead of stacking onto a 2nd line on mobile */}
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setView("year")}
          className={`rs-chip shrink-0 !h-11 sm:!h-7 ${view === "year" ? "active" : ""}`}
        >
          <Table className="mr-1 inline h-3.5 w-3.5" /> รายปี
        </button>
        <button
          type="button"
          onClick={() => setView("month")}
          className={`rs-chip shrink-0 !h-11 sm:!h-7 ${view === "month" ? "active" : ""}`}
        >
          <Calendar className="mr-1 inline h-3.5 w-3.5" /> รายเดือน
        </button>

        {view === "month" && (
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {TH_MONTHS_SHORT.map((label, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setMonth(i + 1)}
                className={`rs-chip shrink-0 !h-11 sm:!h-[26px] !px-3 sm:!px-[9px] ${month === i + 1 ? "active" : ""}`}
                style={{ fontSize: 12 }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {view === "year" && (
          <span className="ml-auto hidden sm:inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--rs-text-3)" }}>
            <span style={{ fontSize: 13 }}>💡</span> กดหัวเดือน (ม.ค./ก.พ. …) เพื่อแยกดู ค่าเช่า · น้ำ · ไฟ — ห้องค่าไฟแพงผิดปกติจะขึ้นแดง
          </span>
        )}
      </div>

      {/* mobile-only horizontal-scroll hint */}
      {units.length > 0 && (
        <div className="mb-2 flex items-center gap-1.5 text-[12px] lg:hidden" style={{ color: "var(--rs-text-3)" }}>
          <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
          ปัดซ้าย-ขวาเพื่อดูทุกเดือน →
        </div>
      )}

      {units.length === 0 ? (
        <div className="rs-card py-10 text-center text-sm" style={{ color: "var(--rs-text-2)" }}>
          ยังไม่มีห้องในโครงการนี้
        </div>
      ) : view === "year" ? (
        /* ============ รายปี: 12-month overview ============ */
        <div className="rs-scroll">
          <table className="rs-grid">
            <thead>
              <tr>
                <th className="rs-sticky-col rs-th-room">ห้อง / ผู้เช่า</th>
                {TH_MONTHS_SHORT.map((label, idx) => {
                  const m = idx + 1;
                  if (!expanded.has(m)) {
                    return (
                      <th key={label} className="rs-th-month rs-th-click" onClick={() => toggleExp(m)} title="กดเพื่อแยก ค่าเช่า/น้ำ/ไฟ">
                        <div>{label} ▸</div>
                        <div className="rs-th-year">{beYear}</div>
                      </th>
                    );
                  }
                  return (
                    <Fragment key={label}>
                      <th className="rs-th-month rs-th-sub rs-th-click" onClick={() => toggleExp(m)} title="กดเพื่อยุบ">
                        <div>{label} ▾</div>
                        <div className="rs-th-sublabel">เช่า</div>
                      </th>
                      <th className="rs-th-month rs-th-sub"><div>&nbsp;</div><div className="rs-th-sublabel">น้ำ</div></th>
                      <th className="rs-th-month rs-th-sub"><div className="rs-th-year">{beYear}</div><div className="rs-th-sublabel">ไฟ ⚡</div></th>
                    </Fragment>
                  );
                })}
                <th className="rs-th-month rs-th-total">รวมทั้งปี</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u, ri) => (
                <tr key={u.id} className={ri % 2 ? "rs-zebra" : ""}>
                  <th className={`rs-sticky-col rs-td-room ${ri % 2 ? "rs-zebra" : ""}`}>
                    <div className="rs-room-code">{u.code}</div>
                    <div className="rs-room-tenant">{u.tenantName ?? "— ว่าง —"}</div>
                  </th>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                    const cell = cells[`${u.id}|${year}-${pad2(m)}`];
                    const exp = expanded.has(m);
                    if (exp) {
                      const avg = monthElecAvg(m);
                      const hot = cell && avg > 0 && cell.electric > avg * 1.5;
                      return (
                        <Fragment key={m}>
                          <td className="rs-cell rs-cell-sub" onClick={() => openCell(u, m)}>
                            <span className="rs-amount">{cell ? formatBaht(cell.rent) : formatBaht(u.baseRent)}</span>
                          </td>
                          <td className="rs-cell rs-cell-sub" onClick={() => openCell(u, m)}>
                            <span style={{ color: "var(--rs-text-2)" }}>{cell ? formatBaht(cell.water) : "—"}</span>
                          </td>
                          <td
                            className="rs-cell rs-cell-sub"
                            onClick={() => openCell(u, m)}
                            style={hot ? { background: "var(--rs-danger-soft)" } : undefined}
                            title={hot ? "ค่าไฟสูงผิดปกติ (>1.5× เฉลี่ยเดือนนี้)" : undefined}
                          >
                            <span style={{ color: hot ? "var(--rs-danger)" : "var(--rs-text-2)", fontWeight: hot ? 800 : 600 }}>
                              {cell ? formatBaht(cell.electric) : "—"}
                            </span>
                          </td>
                        </Fragment>
                      );
                    }
                    if (!cell) {
                      return (
                        <td key={m} className="rs-cell rs-cell-empty" onClick={() => openCell(u, m)}>
                          <span className="rs-expected">{formatBaht(u.baseRent)}</span>
                          <span className="rs-tag-expect">คาด</span>
                        </td>
                      );
                    }
                    const tone = statusTone(cell.status);
                    return (
                      <td
                        key={m}
                        className="rs-cell"
                        style={{ background: tone.bg }}
                        onClick={() => openCell(u, m)}
                      >
                        <span className="rs-amount" style={{ color: tone.color }}>
                          {formatBaht(cell.total)}
                        </span>
                      </td>
                    );
                  })}
                  <td className="rs-cell rs-cell-total">
                    <span className="rs-amount">{formatBaht(roomYearTotal(u.id))}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th className="rs-sticky-col rs-td-room rs-foot-label">รวมต่อเดือน</th>
                {monthsTotals.map((t, i) => {
                  const m = i + 1;
                  if (expanded.has(m)) {
                    return (
                      <Fragment key={i}>
                        <td className="rs-cell rs-foot rs-cell-sub"><span className="rs-amount">{formatBaht(monthSub(m, (c) => c.rent))}</span></td>
                        <td className="rs-cell rs-foot rs-cell-sub"><span className="rs-amount">{formatBaht(monthSub(m, (c) => c.water))}</span></td>
                        <td className="rs-cell rs-foot rs-cell-sub"><span className="rs-amount">{formatBaht(monthSub(m, (c) => c.electric))}</span></td>
                      </Fragment>
                    );
                  }
                  return (
                    <td key={i} className="rs-cell rs-foot">
                      <span className="rs-amount">{formatBaht(t)}</span>
                    </td>
                  );
                })}
                <td className="rs-cell rs-foot rs-cell-total">
                  <span className="rs-amount">{formatBaht(grandYearTotal)}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        /* ============ รายเดือน: full breakdown ============ */
        <MonthView year={year} month={month} units={units} cells={cells} onOpen={openCell} />
      )}

      {/* detail drawer */}
      {active && (
        <CellDetail
          unit={active.unit}
          cell={active.cell}
          month={active.month}
          beYear={beYear}
          onClose={() => setActive(null)}
        />
      )}

      <style jsx>{`
        /* Excel-style frozen panes: the scroll box owns BOTH axes so the
           sticky header (top) + sticky room column (left) freeze correctly.
           A height cap is what makes window-scroll vs overflow-x not fight. */
        .rs-scroll {
          overflow: auto;
          max-height: calc(100dvh - 15rem);
          min-height: 280px;
          overscroll-behavior: contain;
        }
        .rs-grid {
          border-collapse: separate;
          border-spacing: 0;
          width: max-content;
          min-width: 100%;
          font-variant-numeric: tabular-nums;
          font-size: 12.5px;
        }
        .rs-grid th,
        .rs-grid td {
          border-bottom: 1px solid var(--rs-border);
          border-right: 1px solid var(--rs-border);
          white-space: nowrap;
        }
        .rs-grid thead th {
          position: sticky;
          top: 0;
          z-index: 20;
          background: var(--rs-bg-3);
          color: var(--rs-text-2);
          font-weight: 700;
          font-size: 11.5px;
          padding: 6px 8px;
          text-align: center;
          border-top: 1px solid var(--rs-border);
        }
        .rs-th-year {
          font-size: 9.5px;
          font-weight: 600;
          color: var(--rs-text-3);
        }
        .rs-th-total {
          background: var(--rs-brand-50);
          color: var(--rs-brand);
        }
        .rs-th-click {
          cursor: pointer;
        }
        .rs-th-click:hover {
          background: var(--rs-brand-50);
          color: var(--rs-brand);
        }
        .rs-th-sub {
          background: var(--rs-brand-50);
          min-width: 64px;
        }
        .rs-th-sublabel {
          font-size: 9.5px;
          font-weight: 700;
          color: var(--rs-brand);
        }
        .rs-cell-sub {
          min-width: 64px;
          background: rgba(30, 58, 255, 0.03);
        }
        .rs-sticky-col {
          position: sticky;
          left: 0;
          z-index: 15;
          background: var(--rs-bg);
          border-right: 2px solid var(--rs-border) !important;
          text-align: left;
        }
        .rs-th-room {
          z-index: 25 !important;
          width: 200px;
          min-width: 200px;
        }
        .rs-td-room {
          width: 200px;
          min-width: 200px;
          padding: 6px 10px;
          vertical-align: middle;
        }
        .rs-td-room.rs-zebra {
          background: var(--rs-bg-2);
        }
        .rs-room-code {
          font-weight: 700;
          color: var(--rs-text);
          font-size: 13px;
        }
        .rs-room-tenant {
          font-size: 11px;
          color: var(--rs-text-3);
          overflow: hidden;
          text-overflow: ellipsis;
          max-width: 180px;
        }
        .rs-zebra {
          background: var(--rs-bg-2);
        }
        .rs-cell {
          padding: 6px 8px;
          text-align: right;
          cursor: pointer;
          min-width: 76px;
        }
        .rs-cell:hover {
          outline: 2px solid var(--rs-brand);
          outline-offset: -2px;
        }
        .rs-amount {
          font-weight: 600;
          color: var(--rs-text);
        }
        .rs-cell-empty {
          text-align: right;
        }
        .rs-expected {
          color: var(--rs-text-3);
          font-weight: 500;
        }
        .rs-tag-expect {
          margin-left: 4px;
          font-size: 9px;
          font-weight: 700;
          color: var(--rs-text-3);
          background: var(--rs-bg-3);
          padding: 1px 4px;
          border-radius: 4px;
        }
        .rs-cell-total {
          background: var(--rs-brand-50);
        }
        .rs-cell-total .rs-amount {
          color: var(--rs-brand);
        }
        .rs-grid tfoot td,
        .rs-grid tfoot th {
          position: sticky;
          bottom: 0;
          z-index: 12;
          background: var(--rs-bg-3);
          font-weight: 700;
        }
        .rs-grid tfoot .rs-sticky-col {
          z-index: 18;
        }
        .rs-foot-label {
          color: var(--rs-text-2);
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}

/* =================== รายเดือน table =================== */
function MonthView({
  year,
  month,
  units,
  cells,
  onOpen,
}: {
  year: number;
  month: number;
  units: MatrixUnit[];
  cells: Record<string, MatrixCell>;
  onOpen: (u: MatrixUnit, m: number) => void;
}) {
  const key = (u: MatrixUnit) => `${u.id}|${year}-${pad2(month)}`;
  const cols: { label: string; pick: (c: MatrixCell) => number }[] = [
    { label: "ค่าเช่า", pick: (c) => c.rent },
    { label: "ค่าน้ำ", pick: (c) => c.water },
    { label: "ค่าไฟ", pick: (c) => c.electric },
    { label: "อื่นๆ", pick: (c) => c.other },
    { label: "ค่าปรับ", pick: (c) => c.lateFee },
    { label: "ส่วนลด", pick: (c) => c.discount },
    { label: "VAT", pick: (c) => c.vat },
    { label: "รวม", pick: (c) => c.total },
    { label: "จ่าย", pick: (c) => c.paid },
    { label: "คงเหลือ", pick: (c) => c.total - c.paid },
  ];

  const totals = cols.map(() => 0);
  units.forEach((u) => {
    const c = cells[key(u)];
    if (c) cols.forEach((col, i) => (totals[i] += col.pick(c)));
  });

  return (
    <div className="rs-scroll">
      <table className="rs-grid-m">
        <thead>
          <tr>
            <th className="rs-msticky rs-mroom">ห้อง / ผู้เช่า</th>
            {cols.map((c) => (
              <th key={c.label} className="rs-mnum">
                {c.label}
              </th>
            ))}
            <th className="rs-mnum">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {units.map((u, ri) => {
            const c = cells[key(u)];
            return (
              <tr
                key={u.id}
                className={ri % 2 ? "rs-mzebra" : ""}
                onClick={() => onOpen(u, month)}
                style={{ cursor: "pointer" }}
              >
                <th className={`rs-msticky rs-mtd-room ${ri % 2 ? "rs-mzebra" : ""}`}>
                  <div className="rs-room-code">{u.code}</div>
                  <div className="rs-room-tenant">{u.tenantName ?? "— ว่าง —"}</div>
                </th>
                {c ? (
                  cols.map((col, i) => {
                    const v = col.pick(c);
                    const isRemain = i === cols.length - 1;
                    return (
                      <td key={i} className="rs-mcell">
                        <span
                          style={{
                            color: isRemain && v > 0 ? "var(--rs-danger)" : "var(--rs-text)",
                            fontWeight: col.label === "รวม" || isRemain ? 700 : 500,
                          }}
                        >
                          {formatBaht(v)}
                        </span>
                      </td>
                    );
                  })
                ) : (
                  <>
                    <td className="rs-mcell">
                      <span className="rs-expected">{formatBaht(u.baseRent)}</span>
                    </td>
                    {cols.slice(1).map((_, i) => (
                      <td key={i} className="rs-mcell">
                        <span className="rs-expected">—</span>
                      </td>
                    ))}
                  </>
                )}
                <td className="rs-mcell rs-mstatus">
                  {c ? (
                    <span
                      className="rs-pill"
                      style={{
                        background: statusTone(c.status).bg,
                        color: statusTone(c.status).color,
                      }}
                    >
                      {BILL_STATUS[c.status]?.label ?? c.status}
                    </span>
                  ) : (
                    <span className="rs-tag-expect">ยังไม่ออกบิล</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th className="rs-msticky rs-mtd-room rs-mfoot">รวม</th>
            {totals.map((t, i) => (
              <td key={i} className="rs-mcell rs-mfoot">
                <span style={{ fontWeight: 700 }}>{formatBaht(t)}</span>
              </td>
            ))}
            <td className="rs-mcell rs-mfoot" />
          </tr>
        </tfoot>
      </table>

      <style jsx>{`
        .rs-scroll {
          overflow: auto;
          max-height: calc(100dvh - 15rem);
          min-height: 280px;
          overscroll-behavior: contain;
        }
        .rs-grid-m {
          border-collapse: separate;
          border-spacing: 0;
          width: max-content;
          min-width: 100%;
          font-variant-numeric: tabular-nums;
          font-size: 12.5px;
        }
        .rs-grid-m th,
        .rs-grid-m td {
          border-bottom: 1px solid var(--rs-border);
          border-right: 1px solid var(--rs-border);
          white-space: nowrap;
        }
        .rs-grid-m thead th {
          position: sticky;
          top: 0;
          z-index: 20;
          background: var(--rs-bg-3);
          color: var(--rs-text-2);
          font-weight: 700;
          font-size: 11.5px;
          padding: 7px 10px;
          text-align: right;
          border-top: 1px solid var(--rs-border);
        }
        .rs-mroom {
          text-align: left !important;
        }
        .rs-msticky {
          position: sticky;
          left: 0;
          z-index: 15;
          background: var(--rs-bg);
          border-right: 2px solid var(--rs-border) !important;
          text-align: left;
        }
        .rs-grid-m thead .rs-msticky {
          z-index: 25;
        }
        .rs-mtd-room {
          width: 190px;
          min-width: 190px;
          padding: 7px 10px;
        }
        .rs-mtd-room.rs-mzebra {
          background: var(--rs-bg-2);
        }
        .rs-mzebra {
          background: var(--rs-bg-2);
        }
        .rs-room-code {
          font-weight: 700;
          color: var(--rs-text);
          font-size: 13px;
        }
        .rs-room-tenant {
          font-size: 11px;
          color: var(--rs-text-3);
          max-width: 170px;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .rs-mcell {
          padding: 7px 10px;
          text-align: right;
        }
        .rs-mstatus {
          text-align: center;
        }
        .rs-expected {
          color: var(--rs-text-3);
        }
        .rs-pill {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 11px;
          font-weight: 700;
        }
        .rs-tag-expect {
          font-size: 10px;
          font-weight: 700;
          color: var(--rs-text-3);
          background: var(--rs-bg-3);
          padding: 2px 6px;
          border-radius: 6px;
        }
        .rs-grid-m tfoot td,
        .rs-grid-m tfoot th {
          position: sticky;
          bottom: 0;
          z-index: 12;
          background: var(--rs-bg-3);
        }
        .rs-grid-m tfoot .rs-msticky {
          z-index: 18;
        }
        .rs-mfoot {
          color: var(--rs-text);
          font-weight: 700;
        }
      `}</style>
    </div>
  );
}

/* =================== cell detail drawer =================== */
function CellDetail({
  unit,
  cell,
  month,
  beYear,
  onClose,
}: {
  unit: MatrixUnit;
  cell: MatrixCell | null;
  month: number;
  beYear: number;
  onClose: () => void;
}) {
  const remain = cell ? cell.total - cell.paid : 0;
  const rows: { label: string; value: number; strong?: boolean; danger?: boolean }[] = cell
    ? [
        { label: "ค่าเช่า", value: cell.rent },
        { label: "ค่าน้ำ", value: cell.water },
        { label: "ค่าไฟ", value: cell.electric },
        { label: "อื่นๆ", value: cell.other },
        { label: "ค่าปรับล่าช้า", value: cell.lateFee },
        { label: "ส่วนลด", value: -cell.discount },
        { label: "รวมหลังส่วนลด", value: cell.rent + cell.water + cell.electric + cell.other + cell.lateFee - cell.discount, strong: true },
        { label: "VAT", value: cell.vat },
        { label: "รวมทั้งสิ้น", value: cell.total, strong: true },
        { label: "จ่ายแล้ว", value: cell.paid },
        { label: "คงเหลือ", value: remain, strong: true, danger: remain > 0 },
      ]
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      style={{ background: "rgba(15,23,42,0.45)" }}
      onClick={onClose}
    >
      <div
        className="rs-card w-full max-w-md max-h-[88vh] overflow-y-auto rounded-b-none sm:rounded-b-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-4 pb-2">
          <div>
            <div className="text-lg font-bold" style={{ color: "var(--rs-text)" }}>
              ห้อง {unit.code}
            </div>
            <div className="text-[12.5px]" style={{ color: "var(--rs-text-2)" }}>
              {unit.tenantName ?? "— ว่าง —"} · {TH_MONTHS_SHORT[month - 1]} {beYear}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rs-btn-ghost inline-flex h-11 w-11 items-center justify-center !p-0"
            aria-label="ปิด"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-4 pb-4" style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
          {cell ? (
            <>
              <div className="mb-3">
                <span
                  className="inline-block rounded-full px-3 py-1 text-[12px] font-bold"
                  style={{ background: statusTone(cell.status).bg, color: statusTone(cell.status).color }}
                >
                  {BILL_STATUS[cell.status]?.label ?? cell.status}
                </span>
              </div>
              <div
                className="rounded-xl border"
                style={{ borderColor: "var(--rs-border)", fontVariantNumeric: "tabular-nums" }}
              >
                {rows.map((r, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-3.5 py-2 text-[13px]"
                    style={{
                      borderTop: i ? "1px solid var(--rs-border)" : "none",
                      background: r.strong ? "var(--rs-bg-2)" : "transparent",
                    }}
                  >
                    <span style={{ color: "var(--rs-text-2)", fontWeight: r.strong ? 700 : 500 }}>
                      {r.label}
                    </span>
                    <span
                      style={{
                        fontWeight: r.strong ? 700 : 600,
                        color: r.danger ? "var(--rs-danger)" : "var(--rs-text)",
                      }}
                    >
                      {formatBaht(r.value)}
                    </span>
                  </div>
                ))}
              </div>

              {/* timeline: วางบิล → ครบกำหนด → ชำระ (ไส้ใน log) */}
              <div className="mt-4">
                <div className="mb-2 text-[12px] font-semibold" style={{ color: "var(--rs-text-2)" }}>
                  ไทม์ไลน์บิล {cell.billNo ? `· ${cell.billNo}` : ""}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <FileText className="h-3.5 w-3.5" style={{ color: "var(--rs-brand)" }} />
                    <span style={{ color: "var(--rs-text-2)" }}>วางบิล</span>
                    <span className="ml-auto font-medium" style={{ color: "var(--rs-text)" }}>
                      {fmtThaiDate(cell.issueDate)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <Clock className="h-3.5 w-3.5" style={{ color: remain > 0 ? "var(--rs-danger)" : "var(--rs-text-3)" }} />
                    <span style={{ color: "var(--rs-text-2)" }}>ครบกำหนดชำระ</span>
                    <span className="ml-auto font-medium" style={{ color: remain > 0 ? "var(--rs-danger)" : "var(--rs-text)" }}>
                      {fmtThaiDate(cell.dueDate)}
                    </span>
                  </div>
                  {cell.payments.length > 0 ? (
                    cell.payments.map((p, i) => (
                      <div key={i} className="flex items-center gap-2 text-[12.5px]">
                        <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "var(--rs-ok)" }} />
                        <span style={{ color: "var(--rs-text-2)" }}>
                          ชำระ ({PAYMENT_METHODS[p.method] ?? p.method}) {fmtThaiDate(p.paidOn)}
                        </span>
                        <span className="ml-auto font-medium" style={{ color: "var(--rs-ok)" }}>
                          {formatBaht(p.amount)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center gap-2 text-[12.5px]">
                      <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "var(--rs-text-3)" }} />
                      <span style={{ color: "var(--rs-text-3)" }}>ยังไม่มีการชำระ</span>
                    </div>
                  )}
                </div>
              </div>

              {cell.billId && (
                <Link
                  href={`/rentspace/bills/${cell.billId}`}
                  className="rs-btn mt-4 flex w-full items-center justify-center gap-1"
                >
                  เปิดบิลฉบับเต็ม <ChevronRight className="h-4 w-4" />
                </Link>
              )}
            </>
          ) : (
            <div className="py-6 text-center">
              <div className="text-sm" style={{ color: "var(--rs-text-2)" }}>
                ยังไม่ออกบิลสำหรับเดือนนี้
              </div>
              <div className="mt-2 text-[12.5px]" style={{ color: "var(--rs-text-3)" }}>
                ค่าเช่าพื้นฐานที่คาดไว้
              </div>
              <div className="mt-1 text-2xl font-bold tabular-nums" style={{ color: "var(--rs-text)" }}>
                {formatBaht(unit.baseRent)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
