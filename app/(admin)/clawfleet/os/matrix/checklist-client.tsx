"use client";

/**
 * เช็คลิสต์เก็บเงิน — สรุปสุขภาพ "ทุกสาขา" ในหน้าเดียว (READ-ONLY).
 *
 * เลย์เอาต์ตาม mockup (system.dc.html:885-943):
 *   • แถวการ์ดสรุป 5 ใบ: สาขาทั้งหมด · ต้องรีบเก็บ · ตุ๊กตา≠มิเตอร์ · สาขาขาดทุน · เฉลี่ยเก็บครบ
 *   • ตาราง 6 คอลัมน์/สาขา: สาขา(+เว้น/cadence) | ความครบ(แถบ%) | 7 วันล่าสุด(ช่องสี) |
 *     ตุ๊กตาออก↔มิเตอร์ | เฉลี่ย/ตัว·กำไร-ขาดทุน | สถานะ
 *   • footer legend + หมายเหตุต้นทุน ฿90/ตัว
 *
 * ข้อมูลจริงจาก getCfChecklistGrid (byDay สถานะรายวัน). คอลัมน์ที่ต้องใช้เลข
 * เงิน/มิเตอร์/ตู้ (ความครบ·ตุ๊กตา↔มิเตอร์·เฉลี่ย/ตัว) ยังไม่มีใน query นั้น →
 * ข้อมูลจริงจะโชว์ "—" อย่างปลอดภัย (ห้าม fabricate เลขเงิน). DB ว่าง → โชว์
 * ตัวอย่าง DEMO เต็มรูปแบบ (ระบุ "ตัวอย่าง" ชัด) เพื่อให้เห็นภาพครบตาม mockup.
 */

import { useMemo } from "react";
import { CalendarX } from "lucide-react";
import { EmptyState } from "@/components/clawfleet/os/kit";
import { bahtN } from "@/components/clawfleet/os/format";

/** สถานะ 1 สาขา ใน 1 วัน — ตรงกับ CfChecklistStatus ใน checklist-queries.ts */
export type CfChecklistStatus =
  | "COLLECTED"
  | "NOT_COLLECTED"
  | "REFILL_ONLY"
  | "DEPOSITED"
  | "NO_BASELINE";

/** สาขา + map isoDay → สถานะ (serialized จาก server) */
export type ChecklistBranch = {
  branchId: string;
  branchName: string;
  hasBaseline: boolean;
  byDay: Record<string, CfChecklistStatus>;
};

/* ── ค่าคงที่ต้นทุน/ตัว (mockup default ฿90 · TODO: ดึงจาก config เมื่อ query รองรับ) ── */
const COST_PER_DOLL = 90;

/* ── สีตาม mockup (light-theme literal, ตรงกับ --co-* / TONE ใน format.ts) ── */
const C = {
  brand: "#4F46E5",
  track: "#EEF0F3",
  cardBorder: "#E8EAED",
  headBg: "#FAFBFC",
  headLine: "#EDEFF2",
  rowLine: "#F4F5F7",
  ink: "#1A1D21",
  muted: "#6B7280",
  muted2: "#9AA1AB",
  slash: "#C2C7CF",
  green: "#15803D",
  greenBg: "#E7F4EC",
  red: "#B42318",
  redBg: "#FCEDEC",
  redCardBg: "#FFF9F8",
  redCardBorder: "#F3D9D5",
  redSub: "#C2756C",
  amber: "#B45309",
  amberBg: "#FCF1E2",
  amberCardBg: "#FFFBF4",
  amberCardBorder: "#F0E2BE",
  amberSub: "#C89A55",
  neutral: "#5A6270",
  neutralBg: "#F1F2F7",
} as const;

/* grid template ที่ใช้ทั้งหัวตาราง + ทุกแถว (ต้องตรงกันเป๊ะ) */
const GRID_COLS = "158px 1fr 104px 132px 142px 96px";
const GRID_MIN = 820; // ผลรวมคอลัมน์ขั้นต่ำ → เลื่อนแนวนอนบนจอแคบ

/* ── view-model 1 แถว ── */
type StatusKind = "ok" | "overdue" | "meter" | "loss" | "unset";
type Row = {
  branchId: string;
  name: string;
  gapLabel: string;
  gapColor: string;
  pct: number | null; // 0..1 (null = ไม่มีข้อมูล)
  done: number | null;
  machines: number | null;
  coverageUnit: string; // "ตู้" (demo) / "วัน" (real)
  cells: boolean[]; // 7 ช่อง, true = เก็บ
  dollsOut: number | null;
  meterDoll: number | null;
  avgPer: number | null;
  status: StatusKind;
};

const STATUS_META: Record<StatusKind, { label: string; bg: string; color: string }> = {
  ok: { label: "ปกติ", bg: C.greenBg, color: C.green },
  overdue: { label: "ต้องรีบเก็บ", bg: C.redBg, color: C.red },
  meter: { label: "ตุ๊กตา≠มิเตอร์", bg: C.redBg, color: C.red },
  loss: { label: "ขาดทุน", bg: C.amberBg, color: C.amber },
  unset: { label: "รอตั้งค่า", bg: C.neutralBg, color: C.neutral },
};

function barColor(pct: number): string {
  if (pct >= 0.8) return C.green;
  if (pct >= 0.5) return C.amber;
  return C.red;
}

/* ── SAMPLE (เมื่อ DB ว่าง) — deterministic, ไม่มี hydration mismatch ── */
const SAMPLE_NAMES = ["รังสิต", "ลาดพร้าว", "บางแค", "บางนา", "นนทบุรี", "ปทุมธานี", "สมุทรปราการ", "มีนบุรี"];
function mrng(s: number): number {
  const x = Math.sin(s * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
function sampleRows(): Row[] {
  return SAMPLE_NAMES.map((name, bi) => {
    // สาขาสุดท้ายจำลอง "ยังไม่ตั้งค่า"
    if (bi === SAMPLE_NAMES.length - 1) {
      return {
        branchId: `s-${bi}`,
        name,
        gapLabel: "ยังไม่ตั้งค่าตู้",
        gapColor: C.muted2,
        pct: null,
        done: null,
        machines: null,
        coverageUnit: "ตู้",
        cells: Array(7).fill(false),
        dollsOut: null,
        meterDoll: null,
        avgPer: null,
        status: "unset",
      };
    }
    const machines = 6 + Math.floor(mrng(bi * 3 + 1) * 9); // 6..14
    const done = Math.min(machines, Math.round(machines * (0.42 + mrng(bi * 5 + 2) * 0.58)));
    const pct = done / machines;
    // 7 วันล่าสุด (ซ้าย=เก่า → ขวา=วันนี้)
    const cells = Array.from({ length: 7 }, (_, i) => mrng(bi * 31 + i * 7 + 3) > 0.34);
    // เว้นกี่วัน = นับจากขวา (วันนี้) ย้อนไปจนเจอวันเก็บ
    let gap = 0;
    for (let i = cells.length - 1; i >= 0; i--) {
      if (cells[i]) break;
      gap++;
    }
    const target = bi % 2 === 0 ? 2 : 3;
    const overdue = gap > target;
    const dollsOut = 80 + Math.floor(mrng(bi * 7 + 4) * 120); // 80..200
    const mismatch = mrng(bi * 11 + 5) > 0.76;
    const meterDoll = mismatch ? dollsOut + 2 + Math.floor(mrng(bi * 17 + 8) * 5) : dollsOut;
    const avgPer = 62 + Math.floor(mrng(bi * 13 + 6) * 108); // 62..170
    const loss = avgPer < COST_PER_DOLL;
    const status: StatusKind = overdue ? "overdue" : mismatch ? "meter" : loss ? "loss" : "ok";
    const gapLabel = gap === 0 ? `เก็บวันนี้ · เก็บทุก ${target} วัน` : `เว้น ${gap} วัน · เก็บทุก ${target} วัน`;
    return {
      branchId: `s-${bi}`,
      name,
      gapLabel,
      gapColor: overdue ? C.red : C.muted2,
      pct,
      done,
      machines,
      coverageUnit: "ตู้",
      cells,
      dollsOut,
      meterDoll,
      avgPer,
      status,
    };
  });
}

/* ── สร้าง Row จากข้อมูลจริง (byDay) — เติมทุกอย่างที่คำนวณได้, เงิน/มิเตอร์ = null ── */
function realRow(b: ChecklistBranch, iso7: string[], isoAll: string[]): Row {
  if (!b.hasBaseline) {
    return {
      branchId: b.branchId,
      name: b.branchName,
      gapLabel: "ยังไม่ตั้งค่าตู้",
      gapColor: C.muted2,
      pct: null,
      done: null,
      machines: null,
      coverageUnit: "วัน",
      cells: Array(7).fill(false),
      dollsOut: null,
      meterDoll: null,
      avgPer: null,
      status: "unset",
    };
  }
  const isCollected = (s: CfChecklistStatus) => s === "COLLECTED" || s === "DEPOSITED";
  // ความครบ = สัดส่วนวันที่เก็บ ต่อวันที่มีรอบ (ไม่นับ NO_BASELINE)
  let done = 0;
  let tracked = 0;
  for (const d of isoAll) {
    const st = b.byDay[d] ?? "NOT_COLLECTED";
    if (st === "NO_BASELINE") continue;
    tracked += 1;
    if (isCollected(st)) done += 1;
  }
  const pct = tracked > 0 ? done / tracked : 0;
  // 7 วันล่าสุด (ซ้าย=เก่า → ขวา=วันนี้)
  const cells = iso7.map((d) => isCollected(b.byDay[d] ?? "NOT_COLLECTED"));
  // เว้นกี่วัน = นับจากวันนี้ (isoAll[0]) ย้อนไปจนเจอวันเก็บ
  let gap = 0;
  for (const d of isoAll) {
    if (isCollected(b.byDay[d] ?? "NOT_COLLECTED")) break;
    gap++;
  }
  const capped = gap >= isoAll.length;
  const gapLabel = gap === 0 ? "เก็บล่าสุดวันนี้" : capped ? `ไม่เก็บเกิน ${isoAll.length} วัน` : `เว้น ${gap} วัน`;
  return {
    branchId: b.branchId,
    name: b.branchName,
    gapLabel,
    gapColor: gap > 3 ? C.red : C.muted2,
    pct,
    done,
    machines: tracked,
    coverageUnit: "วัน",
    cells,
    dollsOut: null,
    meterDoll: null,
    avgPer: null,
    status: pct >= 0.6 ? "ok" : gap > 3 ? "overdue" : "ok",
  };
}

/* ── การ์ดสรุป 1 ใบ ── */
function SummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "plain" | "red" | "amber" | "brand";
}) {
  const bg = tone === "red" ? C.redCardBg : tone === "amber" ? C.amberCardBg : "#fff";
  const border = tone === "red" ? C.redCardBorder : tone === "amber" ? C.amberCardBorder : C.cardBorder;
  const labelColor = tone === "red" ? C.red : tone === "amber" ? C.amber : C.muted;
  const numColor = tone === "red" ? C.red : tone === "amber" ? C.amber : tone === "brand" ? C.brand : C.ink;
  const subColor = tone === "red" ? C.redSub : tone === "amber" ? C.amberSub : C.muted2;
  return (
    <div style={{ background: bg, border: `1px solid ${border}`, borderRadius: 14, padding: "15px 17px" }}>
      <div style={{ fontSize: 12, color: labelColor, marginBottom: 8 }}>{label}</div>
      <div className="num" style={{ fontSize: 23, fontWeight: 700, color: numColor }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: subColor, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export function ChecklistClient({
  isoDays,
  branches,
}: {
  isoDays: string[];
  branches: ChecklistBranch[];
}) {
  const empty = branches.length === 0;
  const noData = !empty && branches.length === 0; // (คงไว้เพื่อ empty-state ต่างจาก demo)

  const rows: Row[] = useMemo(() => {
    if (empty) return sampleRows();
    // iso จริง: index 0 = วันนี้ (ใหม่→เก่า). 7 วันล่าสุดเรียงซ้าย(เก่า)→ขวา(วันนี้)
    const iso7 = isoDays.slice(0, 7).reverse();
    return branches.map((b) => realRow(b, iso7, isoDays));
  }, [empty, isoDays, branches]);

  const summary = useMemo(() => {
    const branchCount = rows.length;
    const overdue = rows.filter((r) => r.status === "overdue").length;
    // มิเตอร์/ขาดทุน ต้องมีเลขเงินจริงถึงจะนับได้ (real data = null → นับไม่ได้)
    const hasMoney = rows.some((r) => r.avgPer != null);
    const meterBad = rows.filter((r) => r.dollsOut != null && r.meterDoll != null && r.dollsOut !== r.meterDoll).length;
    const loss = rows.filter((r) => r.avgPer != null && r.avgPer < COST_PER_DOLL).length;
    const withPct = rows.filter((r) => r.pct != null) as (Row & { pct: number })[];
    const avgPct = withPct.length > 0 ? Math.round((withPct.reduce((s, r) => s + r.pct, 0) / withPct.length) * 100) : 0;
    return {
      branches: branchCount,
      overdue,
      meterBad: hasMoney ? meterBad : null,
      loss: hasMoney ? loss : null,
      avgPct,
    };
  }, [rows]);

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
    <div style={{ position: "relative" }}>
      {empty && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            background: "var(--co-amber-soft-2)",
            border: "1px solid var(--co-amber-border)",
            borderRadius: 10,
            padding: "9px 14px",
            marginBottom: 14,
            fontSize: 12,
            color: "var(--co-amber-ink)",
          }}
        >
          ยังไม่มีข้อมูลจริง — กำลังแสดง<b>&nbsp;ตัวอย่าง&nbsp;</b>เพื่อให้เห็นภาพเช็คลิสต์เก็บเงิน (สรุปสุขภาพทุกสาขา รอเชื่อมข้อมูลจริงภายหลัง)
        </div>
      )}

      {/* ── แถวการ์ดสรุป 5 ใบ ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 13, marginBottom: 18 }}>
        <SummaryCard tone="plain" label="สาขาทั้งหมด" value={`${summary.branches} สาขา`} />
        <SummaryCard tone="red" label="ต้องรีบเก็บ" value={`${summary.overdue} สาขา`} sub="เว้นห่างเกินกำหนด" />
        <SummaryCard tone="red" label="ตุ๊กตา≠มิเตอร์" value={summary.meterBad == null ? "— สาขา" : `${summary.meterBad} สาขา`} sub="ต้องตรวจสาเหตุ" />
        <SummaryCard tone="amber" label="สาขาขาดทุน" value={summary.loss == null ? "— สาขา" : `${summary.loss} สาขา`} sub="เฉลี่ย/ตัว < ต้นทุน" />
        <SummaryCard tone="brand" label="เฉลี่ยเก็บครบ" value={`${summary.avgPct}%`} sub="ทุกสาขารวมกัน" />
      </div>

      {/* ── ตารางเช็คลิสต์ ── */}
      <div style={{ background: "#fff", border: `1px solid ${C.cardBorder}`, borderRadius: 14, overflow: "hidden", position: "relative" }}>
        {empty && (
          <span style={{ position: "absolute", top: 14, right: 18, zIndex: 4, fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#C2C7CF", pointerEvents: "none" }}>
            ตัวอย่าง · DEMO
          </span>
        )}
        <div style={{ overflowX: "auto" }}>
          <div style={{ minWidth: GRID_MIN }}>
            {/* หัวคอลัมน์ */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: GRID_COLS,
                gap: 12,
                padding: "12px 20px",
                background: C.headBg,
                borderBottom: `1px solid ${C.headLine}`,
                fontSize: 11,
                fontWeight: 700,
                color: C.muted2,
              }}
            >
              <span>สาขา</span>
              <span>ความครบ (เก็บแล้ว/ตู้ทั้งหมด)</span>
              <span>7 วันล่าสุด</span>
              <span>ตุ๊กตาออก ↔ มิเตอร์</span>
              <span>เฉลี่ย/ตัว · กำไร–ขาดทุน</span>
              <span style={{ textAlign: "right" }}>สถานะ</span>
            </div>

            {/* แถวสาขา */}
            {rows.map((r) => {
              const bc = r.pct != null ? barColor(r.pct) : C.muted2;
              const mismatch = r.dollsOut != null && r.meterDoll != null && r.dollsOut !== r.meterDoll;
              const profit = r.avgPer != null ? r.avgPer - COST_PER_DOLL : 0;
              const profitColor = profit >= 0 ? C.green : C.red;
              const st = STATUS_META[r.status];
              return (
                <div
                  key={r.branchId}
                  style={{
                    display: "grid",
                    gridTemplateColumns: GRID_COLS,
                    gap: 12,
                    alignItems: "center",
                    padding: "15px 20px",
                    borderBottom: `1px solid ${C.rowLine}`,
                    opacity: r.status === "unset" ? 0.7 : 1,
                  }}
                >
                  {/* สาขา + เว้น/cadence */}
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{r.name}</div>
                    <div className="num" style={{ fontSize: 11, color: r.gapColor, marginTop: 1, fontWeight: 600 }}>{r.gapLabel}</div>
                  </div>

                  {/* ความครบ */}
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, height: 9, background: C.track, borderRadius: 6, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: r.pct != null ? `${Math.round(r.pct * 100)}%` : "0%", background: bc, borderRadius: 6 }} />
                      </div>
                      <span className="num" style={{ fontSize: 13, fontWeight: 700, color: bc, width: 38 }}>
                        {r.pct != null ? `${Math.round(r.pct * 100)}%` : "—"}
                      </span>
                    </div>
                    <div className="num" style={{ fontSize: 11, color: C.muted2, marginTop: 5 }}>
                      {r.done != null && r.machines != null ? `เก็บแล้ว ${r.done} / ${r.machines} ${r.coverageUnit}` : "ยังไม่ตั้งค่า"}
                    </div>
                  </div>

                  {/* 7 วันล่าสุด */}
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", width: 104 }}>
                    {r.cells.map((on, i) => (
                      <span key={i} style={{ width: 13, height: 13, borderRadius: 4, background: on ? C.brand : C.track }} />
                    ))}
                  </div>

                  {/* ตุ๊กตาออก ↔ มิเตอร์ */}
                  <div>
                    {r.dollsOut != null && r.meterDoll != null ? (
                      <>
                        <div className="num" style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
                          {r.dollsOut} <span style={{ color: C.slash, fontWeight: 400 }}>/</span> {r.meterDoll}
                        </div>
                        <span
                          className="num"
                          style={{
                            display: "inline-block",
                            marginTop: 4,
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "2px 8px",
                            borderRadius: 20,
                            background: mismatch ? C.redBg : C.greenBg,
                            color: mismatch ? C.red : C.green,
                          }}
                        >
                          {mismatch ? "ไม่ตรง" : "ตรง"}
                        </span>
                      </>
                    ) : (
                      <div className="num" style={{ fontSize: 13, fontWeight: 700, color: C.muted2 }}>—</div>
                    )}
                  </div>

                  {/* เฉลี่ย/ตัว · กำไร-ขาดทุน */}
                  <div>
                    {r.avgPer != null ? (
                      <>
                        <div className="num" style={{ fontSize: 15, fontWeight: 800, color: profitColor }}>{bahtN(r.avgPer)} /ตัว</div>
                        <div className="num" style={{ fontSize: 10.5, color: profitColor, marginTop: 2, fontWeight: 600 }}>
                          {profit >= 0 ? `กำไร ${bahtN(profit)}/ตัว` : `ขาดทุน ${bahtN(-profit)}/ตัว`}
                        </div>
                      </>
                    ) : (
                      <div className="num" style={{ fontSize: 15, fontWeight: 800, color: C.muted2 }}>—</div>
                    )}
                  </div>

                  {/* สถานะ */}
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 20, background: st.bg, color: st.color, whiteSpace: "nowrap" }}>
                      {st.label}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* footer legend + หมายเหตุต้นทุน */}
            <div style={{ display: "flex", alignItems: "center", gap: 18, padding: "12px 20px", background: C.headBg, fontSize: 11, color: C.muted2, flexWrap: "wrap" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 13, height: 13, borderRadius: 4, background: C.brand }} />วันที่เก็บเงิน
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 13, height: 13, borderRadius: 4, background: C.track }} />ไม่ได้เก็บ
              </span>
              <span style={{ flex: 1, minWidth: 12 }} />
              <span>ตุ๊กตาออก/มิเตอร์ต้องตรงกัน · เฉลี่ย/ตัวเทียบต้นทุน ฿{COST_PER_DOLL}/ตัว</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
