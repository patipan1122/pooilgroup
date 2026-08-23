"use client";

/**
 * เช็คลิสต์เก็บเงิน — สาขา × วัน เต็มเดือนปฏิทิน (READ-ONLY).
 * โครง/อินเทอร์แอกชันตรงกับ ChairOps ChecklistTab (reconcile-views.tsx) เพื่อให้ทั้งสอง
 * โปรแกรมไปทางเดียวกัน: เดือนปฏิทินจริง + เลื่อนเดือน + จุดสีสถานะ + ขีด "–" ช่องว่าง.
 * ต่างจาก ChairOps ตรงที่ ClawFleet ต้อง "กดสลับ" เพื่อดูยอดเงิน (ไม่ใช้ hover tooltip —
 * CEO เช็คเว็บจากมือถือเป็นหลัก hover ใช้ไม่ได้).
 *
 * ข้อมูลจริงจาก getCfChecklistGrid (cells: สถานะ + ยอดเก็บเงิน/วัน). DB ว่าง → โชว์ตัวอย่าง
 * DEMO (ระบุ "ตัวอย่าง" ชัด) ด้วยรูปทรงข้อมูลเดียวกับของจริง เพื่อไม่ต้องมีโค้ดคู่ขนาน.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarX, ChevronUp, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/clawfleet/os/kit";
import { num } from "@/components/clawfleet/os/format";
import { saveChecklistOrder } from "@/lib/clawfleet/checklist-order-actions";

/** สถานะ 1 สาขา ใน 1 วัน — ตรงกับ CfChecklistStatus ใน checklist-queries.ts */
export type CfChecklistStatus =
  | "COLLECTED"
  | "NOT_COLLECTED"
  | "REFILL_ONLY"
  | "DEPOSITED"
  | "NO_BASELINE";

export type ChecklistDayCell = { status: CfChecklistStatus; amount: number };

/** สาขา + cells รายวัน (index 0 = วันที่ 1 ของเดือน) — serialized จาก server */
export type ChecklistBranch = {
  branchId: string;
  branchName: string;
  hasBaseline: boolean;
  cells: ChecklistDayCell[];
};

/* ── สีตาม mockup (light-theme literal, ตรงกับ --co-* / TONE ใน format.ts) ── */
const C = {
  brand: "#4F46E5",
  cardBorder: "#E8EAED",
  headBg: "#FAFBFC",
  headLine: "#EDEFF2",
  rowLine: "#F4F5F7",
  ink: "#1A1D21",
  muted: "#6B7280",
  muted2: "#9AA1AB",
  green: "#15803D",
  greenBg: "#E7F4EC",
  red: "#B42318",
  redBg: "#FCEDEC",
  redCardBg: "#FFF9F8",
  redCardBorder: "#F3D9D5",
  redSub: "#C2756C",
  amber: "#B45309",
  amberBg: "#FCF1E2",
  neutral: "#5A6270",
  neutralBg: "#F1F2F7",
} as const;

const DOT_MIN_W = 30;
const AMOUNT_MIN_W = 52;
const NAME_COL_W = 188;

/* ── SAMPLE (เมื่อ DB ว่าง) — deterministic ตามรูปทรงข้อมูลเดียวกับของจริง ── */
const SAMPLE_NAMES = ["รังสิต", "ลาดพร้าว", "บางแค", "บางนา", "นนทบุรี", "ปทุมธานี", "สมุทรปราการ", "มีนบุรี"];
function mrng(s: number): number {
  const x = Math.sin(s * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
function sampleBranches(daysInMonth: number, elapsedDays: number): ChecklistBranch[] {
  return SAMPLE_NAMES.map((name, bi) => {
    const noBaseline = bi === SAMPLE_NAMES.length - 1; // สาขาสุดท้ายจำลอง "ยังไม่ตั้งค่า"
    const cells: ChecklistDayCell[] = Array.from({ length: daysInMonth }, (_, di) => {
      if (noBaseline) return { status: "NO_BASELINE", amount: 0 };
      if (di >= elapsedDays) return { status: "NOT_COLLECTED", amount: 0 }; // อนาคต — ยังไม่ถึงวัน
      const roll = mrng(bi * 31 + di * 7 + 3);
      if (roll > 0.78) return { status: "NOT_COLLECTED", amount: 0 };
      if (roll > 0.7) return { status: "REFILL_ONLY", amount: 0 };
      const amount = 400 + Math.floor(mrng(bi * 13 + di * 3 + 9) * 2200);
      return { status: roll > 0.4 ? "DEPOSITED" : "COLLECTED", amount };
    });
    return { branchId: `s-${bi}`, branchName: name, hasBaseline: !noBaseline, cells };
  });
}

/* ── สถานะ 1 ช่อง → รูปแบบจุด ── */
function cellVisual(c: ChecklistDayCell, isFuture: boolean): { kind: "dot" | "dash" | "future"; color?: string; filled?: boolean; label: string } {
  if (isFuture) return { kind: "future", label: "ยังไม่ถึงวัน" };
  switch (c.status) {
    case "DEPOSITED": return { kind: "dot", color: C.green, filled: true, label: "เก็บ+ฝากแล้ว" };
    case "COLLECTED": return { kind: "dot", color: C.amber, filled: true, label: "เก็บแล้ว ยังไม่ฝาก" };
    case "REFILL_ONLY": return { kind: "dot", color: C.brand, filled: false, label: "เติมตุ๊กตาอย่างเดียว" };
    case "NO_BASELINE": return { kind: "dash", label: "ยังไม่ตั้งค่าตู้" };
    default: return { kind: "dash", label: "ไม่มีการเก็บ" };
  }
}

/** วันนี้ (เวลาไทย) → "YYYY-MM-DD" ผ่าน Intl กันปัญหา tz เครื่องผู้ใช้ */
function todayBangkok(): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });
  const [y, m, d] = fmt.format(new Date()).split("-").map(Number);
  return { year: y, month: m, day: d };
}

/** จำนวนวันที่ "ผ่านไปแล้ว" ของเดือนที่กำลังดู — เดือนอนาคต=0 · เดือนอดีต=เต็มเดือน · เดือนนี้=วันนี้ */
function elapsedDaysOf(year: number, month: number, daysInMonth: number): number {
  const t = todayBangkok();
  if (year < t.year || (year === t.year && month < t.month)) return daysInMonth;
  if (year > t.year || (year === t.year && month > t.month)) return 0;
  return t.day;
}

/** ยาวสุดของ streak ที่ไม่เก็บ (นับเฉพาะวันที่ผ่านไปแล้ว ไม่นับ NO_BASELINE/อนาคต) */
function maxNotCollectedStreak(cells: ChecklistDayCell[], elapsedDays: number): number {
  let max = 0;
  let run = 0;
  for (let i = 0; i < elapsedDays; i++) {
    const collected = cells[i].status === "COLLECTED" || cells[i].status === "DEPOSITED";
    if (collected) { run = 0; continue; }
    if (cells[i].status === "REFILL_ONLY") continue; // เติมตุ๊กตาไม่นับเป็นวันขาด (ไม่ต้องมีเงินทุกวัน)
    run += 1;
    max = Math.max(max, run);
  }
  return max;
}

function SummaryCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: "plain" | "red" | "brand" }) {
  const bg = tone === "red" ? C.redCardBg : "#fff";
  const border = tone === "red" ? C.redCardBorder : C.cardBorder;
  const labelColor = tone === "red" ? C.red : C.muted;
  const numColor = tone === "red" ? C.red : tone === "brand" ? C.brand : C.ink;
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 14, padding: "15px 17px" }}>
      <div style={{ fontSize: 12, color: labelColor, marginBottom: 8 }}>{label}</div>
      <div className="num" style={{ fontSize: 23, fontWeight: 700, color: numColor }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted2, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function ChecklistClient({
  year,
  month,
  daysInMonth,
  monthLabel,
  prevYm,
  nextYm,
  branches,
  canReorder,
}: {
  year: number;
  month: number;
  daysInMonth: number;
  monthLabel: string;
  prevYm: string;
  nextYm: string;
  branches: ChecklistBranch[];
  /** true → user เป็น admin-power ที่กดจัดเรียงลำดับสาขาเองได้ */
  canReorder: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [viewMode, setViewMode] = useState<"dot" | "amount">("dot");
  const [pending, startTransition] = useTransition();
  // ลำดับที่กด ▲▼ เอง (optimistic) — ต้อง reset เมื่อเปลี่ยนเดือน ทำผ่าน `key={year-month}`
  // ที่ matrix-client.tsx (remount ทั้งคอมโพเนนต์) แทนการ diff prop ภายใน — เรียบง่ายกว่า
  // effect/ref และเข้ากับกฎ react-hooks/refs ของเรโปนี้ (ห้ามอ่าน/เขียน ref ระหว่าง render)
  const [localOrder, setLocalOrder] = useState<ChecklistBranch[] | null>(null);

  const today = useMemo(() => todayBangkok(), []);
  const elapsedDays = useMemo(() => elapsedDaysOf(year, month, daysInMonth), [year, month, daysInMonth]);
  const empty = branches.length === 0;
  const rows = empty ? sampleBranches(daysInMonth, elapsedDays) : (localOrder ?? branches);
  const noData = !empty && rows.length === 0;

  /** กด ▲▼ — สลับตำแหน่งกับแถวข้างเคียง อัปเดตจอทันที + เซฟเบื้องหลัง (rollback ถ้าล้ม) */
  const moveRow = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    const prevOrder = rows;
    const next = [...rows];
    [next[index], next[target]] = [next[target], next[index]];
    setLocalOrder(next);
    startTransition(() => {
      saveChecklistOrder(next.map((b) => b.branchId)).then((res) => {
        if (!res.ok) {
          setLocalOrder(prevOrder);
          toast.error(res.error);
        }
      });
    });
  };

  const goMonth = (ym: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("ckym", ym);
    startTransition(() => router.push(`/clawfleet/os/matrix?${params.toString()}`, { scroll: false }));
  };

  const summary = useMemo(() => {
    const tracked = rows.filter((r) => r.hasBaseline);
    let doneTotal = 0;
    let trackedTotal = 0;
    let overdue = 0;
    for (const r of tracked) {
      let done = 0;
      for (let i = 0; i < elapsedDays; i++) {
        if (r.cells[i].status === "COLLECTED" || r.cells[i].status === "DEPOSITED") done += 1;
      }
      doneTotal += done;
      trackedTotal += elapsedDays;
      if (maxNotCollectedStreak(r.cells, elapsedDays) > 3) overdue += 1;
    }
    const avgPct = trackedTotal > 0 ? Math.round((doneTotal / trackedTotal) * 100) : 0;
    return { branches: rows.length, overdue, avgPct };
  }, [rows, elapsedDays]);

  if (noData) {
    return (
      <div style={{ background: "#fff", border: `1px solid ${C.cardBorder}`, borderRadius: 14 }}>
        <EmptyState
          icon={<CalendarX size={28} />}
          title="ยังไม่มีสาขาตู้คีบ"
          sub="ยังไม่มีสาขาที่เปิดใช้ตู้คีบในขอบเขตของคุณ — เพิ่มสาขา + ตั้งค่าตู้ก่อน แล้วเช็คลิสต์นี้จะแสดงผล"
        />
      </div>
    );
  }

  return (
    <div style={{ position: "relative", opacity: pending ? 0.6 : 1, transition: "opacity .15s" }}>
      {empty && (
        <div
          style={{
            display: "flex", gap: 8, alignItems: "center",
            background: "var(--co-amber-soft-2)", border: "1px solid var(--co-amber-border)",
            borderRadius: 10, padding: "9px 14px", marginBottom: 14, fontSize: 12, color: "var(--co-amber-ink)",
          }}
        >
          ยังไม่มีข้อมูลจริง — กำลังแสดง<b>&nbsp;ตัวอย่าง&nbsp;</b>เพื่อให้เห็นภาพเช็คลิสต์เก็บเงิน (รอเชื่อมข้อมูลจริงภายหลัง)
        </div>
      )}

      {/* ── การ์ดสรุป 3 ใบ ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 13, marginBottom: 18 }}>
        <SummaryCard tone="plain" label="สาขาทั้งหมด" value={`${summary.branches} สาขา`} />
        <SummaryCard tone="red" label="ต้องรีบเก็บ" value={`${summary.overdue} สาขา`} sub="เว้นติดกันเกิน 3 วัน" />
        <SummaryCard tone="brand" label="เฉลี่ยเก็บครบ" value={`${summary.avgPct}%`} sub={`${monthLabel} ทุกสาขารวมกัน`} />
      </div>

      {/* ── ตารางเช็คลิสต์ ── */}
      <div style={{ background: "#fff", border: `1px solid ${C.cardBorder}`, borderRadius: 14, overflow: "hidden", position: "relative" }}>
        {empty && (
          <span style={{ position: "absolute", top: 14, right: 18, zIndex: 4, fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#C2C7CF", pointerEvents: "none" }}>
            ตัวอย่าง · DEMO
          </span>
        )}

        {/* month nav + toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "13px 18px 0" }}>
          <div style={{ display: "flex", background: C.headBg, border: `1px solid ${C.headLine}`, borderRadius: 9, padding: 3 }}>
            <button onClick={() => goMonth(prevYm)} style={navBtnStyle}>← เดือนก่อน</button>
            <span style={{ fontSize: 13, fontWeight: 700, color: C.ink, padding: "6px 12px", whiteSpace: "nowrap" }}>{monthLabel}</span>
            <button onClick={() => goMonth(nextYm)} style={navBtnStyle}>เดือนถัดไป →</button>
          </div>
          <span style={{ flex: 1 }} />
          <button
            onClick={() => setViewMode((v) => (v === "dot" ? "amount" : "dot"))}
            style={{
              border: "none", cursor: "pointer", fontSize: 12, fontWeight: 700,
              padding: "8px 15px", borderRadius: 9, background: C.brand, color: "#fff",
            }}
          >
            {viewMode === "dot" ? "กดดูยอดเก็บ (บาท)" : "กดดูจุดสี"}
          </button>
        </div>

        {/* legend */}
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap", padding: "10px 18px", fontSize: 11, color: C.muted }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: C.green, display: "inline-block" }} /> เก็บ+ฝากแล้ว
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: C.amber, display: "inline-block" }} /> เก็บแล้ว ยังไม่ฝาก
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", border: `2px solid ${C.brand}`, display: "inline-block" }} /> เติมตุ๊กตาอย่างเดียว
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: C.muted2 }}>–</span> ไม่มีการเก็บ
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: 3, background: C.neutralBg, display: "inline-block" }} /> ยังไม่ตั้งค่าตู้
          </span>
          <span style={{ flex: 1, minWidth: 12 }} />
          <span>หน่วย: {viewMode === "amount" ? "บาท/วัน" : "สถานะ"}</span>
        </div>

        <div style={{ overflow: "auto", maxHeight: "62vh", borderTop: `1px solid ${C.headLine}` }}>
          <table className="num" style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", fontSize: 12 }}>
            <thead>
              <tr>
                <th
                  style={{
                    position: "sticky", top: 0, left: 0, zIndex: 3,
                    background: C.headBg, padding: "8px 14px", textAlign: "left",
                    fontSize: 11, fontWeight: 700, color: C.muted2,
                    borderBottom: `1px solid ${C.headLine}`, borderRight: `1px solid ${C.headLine}`,
                    minWidth: NAME_COL_W, maxWidth: NAME_COL_W,
                  }}
                >
                  สาขา ({rows.length})
                  {canReorder && !empty && (
                    <span style={{ display: "block", fontSize: 9, fontWeight: 500, color: C.muted2 }}>กด ▲▼ จัดเรียงเอง</span>
                  )}
                </th>
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => {
                  const isToday = year === today.year && month === today.month && d === today.day;
                  return (
                    <th
                      key={d}
                      style={{
                        position: "sticky", top: 0, zIndex: 2,
                        background: isToday ? "#EEF0FE" : C.headBg,
                        padding: "8px 2px", textAlign: "center",
                        fontSize: 10.5, fontWeight: 700, color: isToday ? C.brand : C.muted2,
                        borderBottom: `1px solid ${C.headLine}`,
                        minWidth: viewMode === "amount" ? AMOUNT_MIN_W : DOT_MIN_W,
                      }}
                    >
                      {d}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((b, ri) => (
                <tr key={b.branchId}>
                  <th
                    scope="row"
                    style={{
                      position: "sticky", left: 0, zIndex: 1, background: "#fff",
                      textAlign: "left", fontWeight: 600, padding: "8px 8px 8px 14px", fontSize: 12.5,
                      color: C.ink, borderBottom: `1px solid ${C.rowLine}`, borderRight: `1px solid ${C.headLine}`,
                      minWidth: NAME_COL_W, maxWidth: NAME_COL_W,
                      opacity: b.hasBaseline ? 1 : 0.6,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {b.branchName}
                        {!b.hasBaseline && (
                          <span style={{ display: "block", fontSize: 9.5, fontWeight: 500, color: C.muted2 }}>ยังไม่ตั้งค่า</span>
                        )}
                      </div>
                      {canReorder && !empty && (
                        <div style={{ display: "flex", flexDirection: "column", flex: "0 0 auto" }}>
                          <button
                            type="button"
                            onClick={() => moveRow(ri, -1)}
                            disabled={ri === 0}
                            aria-label={`ย้าย ${b.branchName} ขึ้น`}
                            style={{ border: "none", background: "transparent", cursor: ri === 0 ? "default" : "pointer", padding: 1, color: ri === 0 ? C.headLine : C.muted2, lineHeight: 0 }}
                          >
                            <ChevronUp size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => moveRow(ri, 1)}
                            disabled={ri === rows.length - 1}
                            aria-label={`ย้าย ${b.branchName} ลง`}
                            style={{ border: "none", background: "transparent", cursor: ri === rows.length - 1 ? "default" : "pointer", padding: 1, color: ri === rows.length - 1 ? C.headLine : C.muted2, lineHeight: 0 }}
                          >
                            <ChevronDown size={13} />
                          </button>
                        </div>
                      )}
                    </div>
                  </th>
                  {b.cells.map((c, i) => {
                    const isFuture = i >= elapsedDays;
                    const v = cellVisual(c, isFuture);
                    return (
                      <td
                        key={i}
                        title={`วันที่ ${i + 1} · ${v.label}${!isFuture && c.amount > 0 ? ` · ${num(c.amount)} บาท` : ""}`}
                        style={{
                          textAlign: "center", padding: "6px 2px",
                          borderBottom: `1px solid ${C.rowLine}`,
                          background: v.kind === "future" ? "transparent" : undefined,
                        }}
                      >
                        {viewMode === "amount" ? (
                          v.kind === "dot" && c.amount > 0 ? (
                            <span className="num" style={{ fontSize: 10.5, fontWeight: 700, color: v.color }}>{num(c.amount)}</span>
                          ) : v.kind === "future" ? null : (
                            <span style={{ color: C.muted2 }}>–</span>
                          )
                        ) : v.kind === "dot" ? (
                          <span
                            style={{
                              display: "inline-block", width: 11, height: 11, borderRadius: "50%",
                              background: v.filled ? v.color : "transparent",
                              border: v.filled ? "none" : `2px solid ${v.color}`,
                            }}
                          />
                        ) : v.kind === "dash" ? (
                          <span style={{ color: C.muted2 }}>–</span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const navBtnStyle: React.CSSProperties = {
  border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 600,
  padding: "6px 12px", borderRadius: 7, background: "transparent", color: C.muted,
};
