"use client";

import { useState, Fragment, useTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Table, X, Calendar, ChevronRight, FileText, Clock, CheckCircle2, ArrowLeftRight, GripVertical, ArrowUp, ArrowDown, ListOrdered, History } from "lucide-react";
import { formatBaht, BILL_STATUS, PAYMENT_METHODS } from "@/lib/rentspace/format";
import { RsBadge } from "@/components/rentspace/ui";
import type { MatrixUnit, MatrixCell } from "@/lib/rentspace/matrix-data";
import type { RentSpacePaymentSlipVerdict } from "@/lib/rentspace/slip-check";
import { actReorderMatrixUnits, actGetPaymentSlipCheck } from "../../_actions";
import { ExportSummaryButton } from "./export-summary-button";

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

// ตัวเลขในตารางภาพรวม: บาทเต็มจำนวน ไม่มี ฿ ไม่มีสตางค์ (คั่นหลักพัน) เช่น "32,449"
// → ช่องเดือนแคบลง เห็นเดือน+ชื่อผู้เช่าได้มากขึ้น · ยอดเป๊ะทุกสตางค์ยังดูได้ในใบสรุปตอนแตะช่อง (ใช้ formatBaht เต็ม)
const gridBahtFmt = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
function fmtGrid(n: number): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "0";
  return gridBahtFmt.format(Math.round(n));
}

type Props = {
  year: number;
  view: "year" | "month";
  month: number; // 1..12
  units: MatrixUnit[];
  cells: Record<string, MatrixCell>;
  monthsTotals: number[];
  projectId: string;
  canReorder: boolean;
};

function pad2(m: number) {
  return String(m).padStart(2, "0");
}

function statusTone(status: string): { bg: string; color: string } {
  const t = BILL_STATUS[status];
  if (!t) return { bg: "transparent", color: "var(--rs-text)" };
  return { bg: t.soft, color: t.color };
}

export default function MatrixGrid({ year, view, month, units, cells, monthsTotals, projectId, canReorder }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const beYear = year + 543;
  const [active, setActive] = useState<{ unit: MatrixUnit; cell: MatrixCell | null; month: number } | null>(null);

  // ── โหมด "จัดเรียงห้องเอง" (ลากขึ้น-ลง → จำถาวรเฉพาะหน้า Excel นี้) ──
  const [orderMode, setOrderMode] = useState(false);
  const [draft, setDraft] = useState<MatrixUnit[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [saving, startSave] = useTransition();

  function enterOrder() {
    setDraft([...units]);
    setOrderMode(true);
  }
  function cancelOrder() {
    setOrderMode(false);
    setDragIdx(null);
  }
  function moveTo(from: number, to: number) {
    if (from === to || to < 0 || to >= draft.length) return;
    setDraft((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }
  function saveOrder() {
    const ids = draft.map((u) => u.id);
    startSave(async () => {
      try {
        await actReorderMatrixUnits(projectId, ids);
        setOrderMode(false);
        setDragIdx(null);
        router.refresh();
      } catch {
        alert("บันทึกลำดับไม่สำเร็จ ลองอีกครั้ง");
      }
    });
  }

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

  // ── ยืดตารางให้เต็มถึงแถบเมนูล่างพอดี (กันช่องว่างขาวใต้ตาราง) ──
  // วัดตำแหน่งจริงตอน render (ไม่เดาเลข reserve) → บนมือถือ box สูง = จากบนกล่องถึงหัวแถบเมนู
  // fixed ล่าง (#rs-bottom-nav) · desktop (lg) ไม่มีแถบล่าง → คืนค่า CSS เดิม
  useEffect(() => {
    const fit = () => {
      const box = document.querySelector<HTMLElement>(".rs-matrix .rs-scroll");
      if (!box) return;
      if (!window.matchMedia("(max-width: 1023px)").matches) {
        box.style.maxHeight = "";
        return;
      }
      const nav = document.getElementById("rs-bottom-nav");
      const boxTop = box.getBoundingClientRect().top;
      const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
      const avail = Math.round(navTop - boxTop - 8);
      if (avail > 280) box.style.maxHeight = `${avail}px`;
    };
    fit();
    const t = window.setTimeout(fit, 120); // เผื่อ layout/ฟอนต์ settle
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, [view, month, year, orderMode]);

  // ── โหมดจัดเรียง: แสดงรายการห้องให้ลาก/เลื่อนขึ้น-ลง แทนตาราง Excel ──
  if (orderMode) {
    return (
      <div className="rs-matrix min-w-0">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <div className="text-sm font-bold" style={{ color: "var(--rs-text)" }}>จัดลำดับห้อง</div>
            <div className="text-[12px]" style={{ color: "var(--rs-text-3)" }}>
              ลากที่ ⠿ หรือกดลูกศร ▲▼ · ห้องบนสุด = แถวแรกของตาราง
            </div>
          </div>
          <button type="button" onClick={cancelOrder} disabled={saving} className="rs-btn-ghost !h-9">
            ยกเลิก
          </button>
          <button type="button" onClick={saveOrder} disabled={saving} className="rs-btn !h-9 inline-flex items-center gap-1">
            <CheckCircle2 className="h-4 w-4" /> {saving ? "กำลังบันทึก…" : "บันทึกลำดับ"}
          </button>
        </div>

        <div className="rs-reorder">
          {draft.map((u, i) => (
            <div
              key={u.id}
              draggable={!saving}
              onDragStart={() => setDragIdx(i)}
              onDragEnter={() => {
                if (dragIdx !== null && dragIdx !== i) {
                  moveTo(dragIdx, i);
                  setDragIdx(i);
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onDragEnd={() => setDragIdx(null)}
              className={`rs-reorder-row ${dragIdx === i ? "rs-reorder-drag" : ""}`}
            >
              <GripVertical className="rs-grip h-4 w-4 shrink-0" />
              <span className="rs-reorder-num tabular-nums">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span style={{ fontWeight: 700, color: "var(--rs-text)", fontSize: 13 }}>{u.code}</span>
                  <RsBadge kind="unit" status={u.status} />
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--rs-text-3)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {u.name ?? u.tenantName ?? "— ว่าง —"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label="เลื่อนขึ้น"
                  disabled={i === 0 || saving}
                  onClick={() => moveTo(i, i - 1)}
                  className="rs-move-btn"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="เลื่อนลง"
                  disabled={i === draft.length - 1 || saving}
                  onClick={() => moveTo(i, i + 1)}
                  className="rs-move-btn"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <style jsx>{`
          .rs-reorder {
            max-height: calc(100dvh - 15rem);
            overflow: auto;
            border: 1px solid var(--rs-border);
            border-radius: 12px;
            overscroll-behavior: contain;
          }
          .rs-reorder-row {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 8px 10px;
            border-bottom: 1px solid var(--rs-border);
            background: var(--rs-bg);
            cursor: grab;
            user-select: none;
          }
          .rs-reorder-row:last-child {
            border-bottom: none;
          }
          .rs-reorder-drag {
            background: var(--rs-brand-50);
            outline: 2px solid var(--rs-brand);
            outline-offset: -2px;
          }
          .rs-grip {
            color: var(--rs-text-3);
          }
          .rs-reorder-num {
            width: 26px;
            text-align: right;
            font-size: 11px;
            font-weight: 700;
            color: var(--rs-text-3);
          }
          .rs-move-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            border-radius: 8px;
            color: var(--rs-text-2);
            border: 1px solid var(--rs-border);
            background: var(--rs-bg);
          }
          .rs-move-btn:disabled {
            opacity: 0.35;
          }
          .rs-move-btn:not(:disabled):hover {
            background: var(--rs-brand-50);
            color: var(--rs-brand);
            border-color: var(--rs-brand);
          }
        `}</style>
      </div>
    );
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

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {view === "year" && (
            <span className="hidden lg:inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--rs-text-3)" }}>
              <span style={{ fontSize: 13 }}>💡</span> กดหัวเดือนเพื่อแยกดู ค่าเช่า · น้ำ · ไฟ
            </span>
          )}
          {units.length > 0 && <ExportSummaryButton projectId={projectId} />}
          {canReorder && units.length > 0 && (
            <button type="button" onClick={enterOrder} className="rs-chip shrink-0 !h-11 sm:!h-7">
              <ListOrdered className="mr-1 inline h-3.5 w-3.5" /> จัดเรียง
            </button>
          )}
        </div>
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
                    <div className="rs-room-tenant">{u.name ?? u.tenantName ?? "— ว่าง —"}</div>
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
                            <span className="rs-amount">{cell ? fmtGrid(cell.rent) : fmtGrid(u.baseRent)}</span>
                          </td>
                          <td className="rs-cell rs-cell-sub" onClick={() => openCell(u, m)}>
                            <span style={{ color: "var(--rs-text-2)" }}>{cell ? fmtGrid(cell.water) : "—"}</span>
                          </td>
                          <td
                            className="rs-cell rs-cell-sub"
                            onClick={() => openCell(u, m)}
                            style={hot ? { background: "var(--rs-danger-soft)" } : undefined}
                            title={hot ? "ค่าไฟสูงผิดปกติ (>1.5× เฉลี่ยเดือนนี้)" : undefined}
                          >
                            <span style={{ color: hot ? "var(--rs-danger)" : "var(--rs-text-2)", fontWeight: hot ? 800 : 600 }}>
                              {cell ? fmtGrid(cell.electric) : "—"}
                            </span>
                          </td>
                        </Fragment>
                      );
                    }
                    if (!cell) {
                      return (
                        <td key={m} className="rs-cell rs-cell-empty" onClick={() => openCell(u, m)}>
                          <span className="rs-expected">{fmtGrid(u.baseRent)}</span>
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
                        {cell.edited && <span className="rs-edited-dot" title="เคยแก้ไขรายการบิล" />}
                        {cell.ledgerStatus !== "not_sent" && (
                          <span
                            className={`rs-ledger-dot ${cell.ledgerStatus === "sent_matched" ? "cell-matched-iridescent" : ""}`}
                            style={cell.ledgerStatus === "sent_unmatched" ? { background: "var(--rs-info)" } : undefined}
                            title={cell.ledgerStatus === "sent_matched" ? "จับคู่กับธนาคารแล้ว" : "ส่งเข้าบัญชี LedgerLine แล้ว · รอจับคู่"}
                          />
                        )}
                        <span className="rs-amount" style={{ color: tone.color }}>
                          {fmtGrid(cell.total)}
                        </span>
                      </td>
                    );
                  })}
                  <td className="rs-cell rs-cell-total">
                    <span className="rs-amount">{fmtGrid(roomYearTotal(u.id))}</span>
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
                        <td className="rs-cell rs-foot rs-cell-sub"><span className="rs-amount">{fmtGrid(monthSub(m, (c) => c.rent))}</span></td>
                        <td className="rs-cell rs-foot rs-cell-sub"><span className="rs-amount">{fmtGrid(monthSub(m, (c) => c.water))}</span></td>
                        <td className="rs-cell rs-foot rs-cell-sub"><span className="rs-amount">{fmtGrid(monthSub(m, (c) => c.electric))}</span></td>
                      </Fragment>
                    );
                  }
                  return (
                    <td key={i} className="rs-cell rs-foot">
                      <span className="rs-amount">{fmtGrid(t)}</span>
                    </td>
                  );
                })}
                <td className="rs-cell rs-foot rs-cell-total">
                  <span className="rs-amount">{fmtGrid(grandYearTotal)}</span>
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
          max-width: 190px;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          line-height: 1.25;
        }
        .rs-zebra {
          background: var(--rs-bg-2);
        }
        .rs-cell {
          position: relative;
          padding: 6px 6px;
          text-align: right;
          cursor: pointer;
          min-width: 56px;
        }
        .rs-cell:hover {
          outline: 2px solid var(--rs-brand);
          outline-offset: -2px;
        }
        .rs-edited-dot {
          position: absolute;
          top: 3px;
          right: 3px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--rs-edited);
        }
        .rs-ledger-dot {
          position: absolute;
          top: 3px;
          left: 3px;
          width: 6px;
          height: 6px;
          border-radius: 50%;
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
                  <div className="rs-room-tenant">{u.name ?? u.tenantName ?? "— ว่าง —"}</div>
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
                          {fmtGrid(v)}
                        </span>
                      </td>
                    );
                  })
                ) : (
                  <>
                    <td className="rs-mcell">
                      <span className="rs-expected">{fmtGrid(u.baseRent)}</span>
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
                <span style={{ fontWeight: 700 }}>{fmtGrid(t)}</span>
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
          max-width: 190px;
          overflow: hidden;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          line-height: 1.25;
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
  const [slipOpenId, setSlipOpenId] = useState<string | null>(null);
  // CEO 2026-09-09: AI ตรวจสลิปแต่ละแถว (วันที่+เลขบัญชีปลายทาง ตรงกับที่บันทึกไว้ไหม)
  // — ยิงเฉพาะ payment ที่มีสลิปใน popup ที่เปิดอยู่นี้เท่านั้น (ไม่ใช่ทั้งตาราง คุมต้นทุน AI)
  // ไม่มี entry ใน map นี้เลย = ยังโหลดอยู่ (แสดงจุดเทา) — ไม่ seed "loading" ตรงๆ ใน effect
  // เพราะ setState synchronous ใน effect body ทำให้ cascading render (eslint react-hooks/
  // set-state-in-effect บล็อกไว้) — set แค่ตอนผลตอบกลับจริง (async .then/.catch) เท่านั้น
  const [slipChecks, setSlipChecks] = useState<
    Record<string, { status: "done"; verdict: RentSpacePaymentSlipVerdict | null }>
  >({});

  useEffect(() => {
    if (!cell) return;
    const targets = cell.payments.filter((p) => p.slipUrl);
    if (targets.length === 0) return;
    let cancelled = false;
    for (const p of targets) {
      actGetPaymentSlipCheck(p.id)
        .then((verdict) => {
          if (cancelled) return;
          setSlipChecks((prev) => ({ ...prev, [p.id]: { status: "done", verdict } }));
        })
        .catch(() => {
          if (cancelled) return;
          setSlipChecks((prev) => ({ ...prev, [p.id]: { status: "done", verdict: null } }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [cell]);

  const slipOpenPayment = cell?.payments.find((p) => p.id === slipOpenId) ?? null;
  const slipOpenCheck = slipOpenId ? slipChecks[slipOpenId] : undefined;

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
              {unit.name ?? unit.tenantName ?? "— ว่าง —"} · {TH_MONTHS_SHORT[month - 1]} {beYear}
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
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                <span
                  className="inline-block rounded-full px-3 py-1 text-[12px] font-bold"
                  style={{ background: statusTone(cell.status).bg, color: statusTone(cell.status).color }}
                >
                  {BILL_STATUS[cell.status]?.label ?? cell.status}
                </span>
                {cell.ledgerStatus === "sent_matched" && (
                  <span className="cell-matched-iridescent inline-block rounded-full px-2.5 py-1 text-[11.5px]">
                    จับคู่บัญชีแล้ว
                  </span>
                )}
                {cell.ledgerStatus === "sent_unmatched" && (
                  <span
                    className="inline-block rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
                    style={{ background: "var(--rs-info-soft)", color: "var(--rs-info)" }}
                  >
                    ส่งบัญชีแล้ว · รอจับคู่
                  </span>
                )}
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
                    cell.payments.map((p, i) => {
                      const check = p.slipUrl ? slipChecks[p.id] : undefined;
                      const dotColor =
                        check?.status === "done"
                          ? check.verdict?.ok
                            ? "var(--rs-ok)"
                            : "var(--rs-danger)"
                          : "var(--rs-text-3)";
                      const dotTitle =
                        check?.status === "done"
                          ? (check.verdict?.ok
                              ? "AI ตรวจสลิป: วันที่+เลขบัญชีปลายทาง ตรงกับที่บันทึกไว้"
                              : (check.verdict?.reason ?? "AI ตรวจสลิป: ไม่ตรงกับที่บันทึกไว้"))
                          : "AI กำลังตรวจสลิป…";
                      return (
                        <div key={i} className="space-y-1">
                          <div className="flex items-center gap-2 text-[12.5px]">
                            <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "var(--rs-ok)" }} />
                            <span style={{ color: "var(--rs-text-2)" }}>
                              ชำระ ({PAYMENT_METHODS[p.method] ?? p.method}) {fmtThaiDate(p.paidOn)}
                            </span>
                            {p.slipUrl && (
                              <button
                                type="button"
                                className="rs-chip inline-flex items-center gap-1.5"
                                style={{ color: "var(--rs-brand)" }}
                                onClick={() => setSlipOpenId(p.id)}
                              >
                                <span
                                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                                  style={{ background: dotColor }}
                                  title={dotTitle}
                                  aria-label={dotTitle}
                                />
                                ดูสลิป
                              </button>
                            )}
                            <span className="ml-auto font-medium" style={{ color: "var(--rs-ok)" }}>
                              {formatBaht(p.amount)}
                            </span>
                          </div>
                          {p.requiresReview && (
                            <div
                              className="ml-5.5 rounded-md px-2 py-1 text-[11.5px]"
                              style={{ background: "var(--rs-danger-soft)", color: "var(--rs-danger)" }}
                            >
                              ⚠ AI ตรวจพบความผิดปกติ — {p.ocrFlagReason ?? "กรุณาตรวจสอบสลิปนี้"}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="flex items-center gap-2 text-[12.5px]">
                      <CheckCircle2 className="h-3.5 w-3.5" style={{ color: "var(--rs-text-3)" }} />
                      <span style={{ color: "var(--rs-text-3)" }}>ยังไม่มีการชำระ</span>
                    </div>
                  )}
                </div>
              </div>

              {cell.billId && (
                <div className="mt-4 flex gap-2">
                  <Link
                    href={`/rentspace/bills/${cell.billId}`}
                    className="rs-btn flex flex-1 items-center justify-center gap-1"
                  >
                    เปิดบิลฉบับเต็ม <ChevronRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href={`/rentspace/bills/${cell.billId}/history`}
                    aria-label="ดูประวัติการแก้ไข"
                    title="ดูประวัติการแก้ไข"
                    className="rs-btn-ghost inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center !p-0 rounded-xl"
                  >
                    <History className="h-4 w-4" />
                  </Link>
                </div>
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
      {slipOpenId && slipOpenPayment?.slipUrl && (
        <div
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 overflow-y-auto p-4 sm:flex-row"
          style={{ background: "rgba(0,0,0,0.85)" }}
          onClick={(e) => {
            e.stopPropagation();
            setSlipOpenId(null);
          }}
        >
          <button
            type="button"
            aria-label="ปิด"
            className="absolute right-4 top-4 rounded-full p-2"
            style={{ background: "rgba(255,255,255,0.15)", color: "#fff" }}
            onClick={(e) => {
              e.stopPropagation();
              setSlipOpenId(null);
            }}
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- สลิปมาจาก R2 dynamic URL ไม่ผ่าน next/image domain allowlist */}
          <img
            src={slipOpenPayment.slipUrl}
            alt="สลิปการชำระเงิน"
            className="max-h-[55vh] max-w-[95vw] shrink-0 rounded-lg object-contain sm:max-h-[85vh] sm:max-w-[52vw]"
            onClick={(e) => e.stopPropagation()}
          />
          {/* ผลตรวจ AI: วันที่/เลขบัญชีปลายทางที่อ่านได้ เทียบกับที่บันทึกไว้ — เห็นเหตุผลเขียว/แดงตรงๆ */}
          <div
            className="rs-card w-full max-w-sm shrink-0 p-3.5 text-[12.5px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 text-[13px] font-bold" style={{ color: "var(--rs-text)" }}>
              {slipOpenCheck?.status === "done" ? (
                slipOpenCheck.verdict?.ok ? (
                  <span style={{ color: "var(--rs-ok)" }}>✓ AI ตรวจสลิปตรงกับที่บันทึกไว้</span>
                ) : (
                  <span style={{ color: "var(--rs-danger)" }}>⚠ AI ตรวจสลิปไม่ตรงกับที่บันทึกไว้</span>
                )
              ) : (
                <span style={{ color: "var(--rs-text-3)" }}>AI กำลังตรวจสลิป…</span>
              )}
            </div>
            {slipOpenCheck?.status === "done" && slipOpenCheck.verdict?.reason && (
              <div
                className="mb-2.5 rounded-md px-2.5 py-1.5"
                style={{ background: "var(--rs-danger-soft)", color: "var(--rs-danger)" }}
              >
                {slipOpenCheck.verdict.reason}
              </div>
            )}
            <div className="space-y-1.5" style={{ fontVariantNumeric: "tabular-nums" }}>
              <SlipFactRow label="บันทึกไว้ · วันที่ชำระ" value={fmtThaiDate(slipOpenPayment.paidOn)} />
              <SlipFactRow label="บันทึกไว้ · ยอด" value={formatBaht(slipOpenPayment.amount)} />
              <SlipFactRow
                label="AI อ่านสลิป · วันที่"
                value={slipOpenCheck?.verdict?.ocrDate ? fmtThaiDate(slipOpenCheck.verdict.ocrDate) : "—"}
                tone={
                  slipOpenCheck?.status === "done"
                    ? slipOpenCheck.verdict?.dateMatch
                      ? "ok"
                      : "danger"
                    : undefined
                }
              />
              <SlipFactRow
                label="AI อ่านสลิป · ยอด"
                value={
                  slipOpenCheck?.verdict?.ocrAmount != null ? formatBaht(slipOpenCheck.verdict.ocrAmount) : "—"
                }
              />
              <SlipFactRow
                label="AI อ่านสลิป · เลขบัญชีปลายทาง"
                value={slipOpenCheck?.verdict?.ocrAccountNumber ?? "—"}
                tone={
                  slipOpenCheck?.status === "done"
                    ? slipOpenCheck.verdict?.acctMatch
                      ? "ok"
                      : "danger"
                    : undefined
                }
              />
              <SlipFactRow label="AI อ่านสลิป · ชื่อบัญชี" value={slipOpenCheck?.verdict?.ocrAccountName ?? "—"} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SlipFactRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "danger";
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span style={{ color: "var(--rs-text-3)" }}>{label}</span>
      <span
        className="text-right font-semibold"
        style={{ color: tone === "ok" ? "var(--rs-ok)" : tone === "danger" ? "var(--rs-danger)" : "var(--rs-text)" }}
      >
        {value}
      </span>
    </div>
  );
}
