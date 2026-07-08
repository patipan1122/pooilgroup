"use client";

/**
 * เช็คลิสต์ "สาขา × วัน" — เก็บเงินครบทุกสาขาทุกวันไหม (READ-ONLY).
 * แถว = สาขา · คอลัมน์ = วัน (ใหม่→เก่า) · ช่อง = จุดสี 1 จุดต่อสถานะ:
 *   🟢 COLLECTED   = เก็บแล้ว (ยังไม่ฝากธนาคาร)
 *   🟢+วง DEPOSITED = เก็บ + ฝากธนาคารแล้ว (มีวงเขียวรอบจุด)
 *   🟠 REFILL_ONLY = วันนั้นเติมตุ๊กตาอย่างเดียว ไม่มีเก็บเงิน
 *   ╌  NOT_COLLECTED = ไม่มีรอบเก็บ (ขีดเทาอ่อน — ไม่ใช่แดง)
 *   ⚪ NO_BASELINE  = สาขายังไม่ตั้งค่าตู้ → ทั้งแถวเทา + ป้าย "รอตั้งค่า"
 * NO_BASELINE/ว่าง = เทากลาง ไม่เคยแดง (ข้อมูลไม่ครบ ≠ ผิดพลาด).
 *
 * ข้อมูลจริงจาก getCfChecklistGrid (page.tsx). DB ว่าง → โชว์ SAMPLE deterministic.
 */

import { useMemo } from "react";
import { CalendarX } from "lucide-react";
import { EmptyState } from "@/components/clawfleet/os/kit";
import { thDate, thWeekday, TONE, type Tone } from "@/components/clawfleet/os/format";

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

/* ── สี/label ต่อสถานะ (ใช้ clawos tokens ผ่าน TONE) ── */
type DotSpec = { fill: string; ring?: string; label: string; tone: Tone };
const DOT: Record<CfChecklistStatus, DotSpec> = {
  COLLECTED: { fill: TONE.green.text, label: "เก็บแล้ว", tone: "green" },
  DEPOSITED: { fill: TONE.green.text, ring: TONE.green.text, label: "เก็บ + ฝากแล้ว", tone: "green" },
  REFILL_ONLY: { fill: TONE.amber.text, label: "เติมตุ๊กตา", tone: "amber" },
  NOT_COLLECTED: { fill: TONE.neutral.border, label: "ไม่มีรอบเก็บ", tone: "neutral" },
  NO_BASELINE: { fill: TONE.neutral.border, label: "ยังไม่ตั้งค่า", tone: "neutral" },
};

/* ── SAMPLE (เมื่อ DB ว่าง) — deterministic, ไม่มี hydration mismatch ── */
const SAMPLE_NAMES = ["รังสิต", "ลาดพร้าว", "บางแค", "บางนา", "นนทบุรี", "ปทุมธานี", "สมุทรปราการ", "มีนบุรี"];
function mrng(s: number): number {
  const x = Math.sin(s * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
function sampleIsoDays(n: number): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });
  const out: string[] = [];
  const now = Date.now();
  for (let i = 0; i < n; i++) out.push(fmt.format(new Date(now - i * 86_400_000)));
  return out;
}
function sampleData(iso: string[]): ChecklistBranch[] {
  return SAMPLE_NAMES.map((name, bi) => {
    // สาขาสุดท้ายจำลอง "ยังไม่ตั้งค่า" (ทั้งแถวเทา)
    const hasBaseline = bi !== SAMPLE_NAMES.length - 1;
    const byDay: Record<string, CfChecklistStatus> = {};
    iso.forEach((d, di) => {
      if (!hasBaseline) {
        byDay[d] = "NO_BASELINE";
        return;
      }
      const r = mrng(bi * 31 + di * 7 + 3);
      byDay[d] =
        r > 0.78 ? "REFILL_ONLY" : r > 0.62 ? "DEPOSITED" : r > 0.2 ? "COLLECTED" : "NOT_COLLECTED";
    });
    return { branchId: `s-${bi}`, branchName: name, hasBaseline, byDay };
  });
}

/** parse "YYYY-MM-DD" → Date (เที่ยงวัน กัน DST) สำหรับ label */
function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
}

/* ── จุดสถานะ (dot) ── */
function StatusDot({ status }: { status: CfChecklistStatus }) {
  const spec = DOT[status];
  if (status === "NOT_COLLECTED") {
    // ขีดเทาอ่อน (ไม่ใช่จุด) — "ไม่มีรอบเก็บ" ให้ดูจางกว่าจุดจริง
    return <span aria-label={spec.label} style={{ display: "inline-block", width: 10, height: 2, borderRadius: 2, background: spec.fill }} />;
  }
  if (status === "NO_BASELINE") {
    return <span aria-label={spec.label} style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "transparent", border: `1.5px solid ${spec.fill}` }} />;
  }
  return (
    <span
      aria-label={spec.label}
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: spec.fill,
        ...(spec.ring ? { boxShadow: `0 0 0 2px #fff, 0 0 0 3.5px ${spec.ring}` } : {}),
      }}
    />
  );
}

const CELL: React.CSSProperties = {
  padding: "8px 4px",
  textAlign: "center",
  borderBottom: "1px solid var(--co-border-2)",
  borderRight: "1px solid var(--co-border-3)",
  whiteSpace: "nowrap",
};

export function ChecklistClient({
  isoDays,
  branches,
}: {
  isoDays: string[];
  branches: ChecklistBranch[];
}) {
  const empty = branches.length === 0;

  // เลือก iso/branches จริง หรือ SAMPLE เมื่อ DB ว่าง
  const { iso, rows } = useMemo(() => {
    if (empty) {
      const sIso = isoDays.length > 0 ? isoDays : sampleIsoDays(31);
      return { iso: sIso, rows: sampleData(sIso) };
    }
    return { iso: isoDays, rows: branches };
  }, [empty, isoDays, branches]);

  // สรุปต่อสาขา (นับวันที่เก็บ/ฝาก เพื่อโชว้ข้าง ๆ ชื่อสาขา)
  const summary = useMemo(() => {
    const m = new Map<string, { collected: number; total: number }>();
    for (const b of rows) {
      let collected = 0;
      let total = 0;
      for (const iso2 of iso) {
        const st = b.byDay[iso2] ?? "NOT_COLLECTED";
        if (st === "NO_BASELINE") continue;
        total += 1;
        if (st === "COLLECTED" || st === "DEPOSITED") collected += 1;
      }
      m.set(b.branchId, { collected, total });
    }
    return m;
  }, [rows, iso]);

  const noData = !empty && rows.length === 0;

  if (noData) {
    return (
      <div style={{ background: "var(--co-surface)", border: "1px solid var(--co-border)", borderRadius: 14 }}>
        <EmptyState
          icon={<CalendarX size={28} />}
          title="ยังไม่มีสาขาตู้คีบ"
          sub="ยังไม่มีสาขาที่เปิดใช้ตู้คีบในขอบเขตของคุณ — เพิ่มสาขา + ตั้งค่าตู้ก่อน แล้วเช็คลิสต์นี้จะแสดงผล"
        />
      </div>
    );
  }

  return (
    <div>
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
          ยังไม่มีข้อมูลจริง — กำลังแสดง<b>&nbsp;ตัวอย่าง&nbsp;</b>เพื่อให้เห็นภาพเช็คลิสต์ (สาขา×วัน รอเชื่อมข้อมูลจริงภายหลัง)
        </div>
      )}

      <div style={{ fontSize: 12, color: "var(--co-muted-2)", marginBottom: 12 }}>
        แต่ละช่อง = วันนั้นสาขานั้นเก็บเงินหรือยัง — ดูครบทุกสาขาย้อนหลัง {iso.length} วันในหน้าเดียว
      </div>

      {/* legend */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 12,
          fontSize: 11,
          color: "var(--co-muted)",
        }}
      >
        {(["COLLECTED", "DEPOSITED", "REFILL_ONLY", "NOT_COLLECTED", "NO_BASELINE"] as CfChecklistStatus[]).map((s) => (
          <span key={s} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <StatusDot status={s} /> {DOT[s].label}
          </span>
        ))}
      </div>

      {/* the checklist grid — sticky first col (branch) + sticky header (days) */}
      <div style={{ position: "relative", background: "var(--co-surface)", border: "1px solid var(--co-border)", borderRadius: 14, overflow: "hidden" }}>
        {empty && (
          <span style={{ position: "absolute", top: 10, right: 16, zIndex: 4, fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#C2C7CF", pointerEvents: "none" }}>
            ตัวอย่าง · DEMO
          </span>
        )}
        <div style={{ overflow: "auto", maxHeight: "62vh" }}>
          <table className="num" style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", fontSize: 12 }}>
            <thead>
              <tr>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    left: 0,
                    zIndex: 3,
                    background: "var(--co-brand-tint)",
                    padding: "9px 12px",
                    textAlign: "left",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#5A6270",
                    borderBottom: "1px solid var(--co-line)",
                    borderRight: "1px solid var(--co-line)",
                    minWidth: 148,
                  }}
                >
                  สาขา
                </th>
                {iso.map((d, di) => {
                  const dt = isoToDate(d);
                  const today = di === 0;
                  return (
                    <th
                      key={d}
                      style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 2,
                        background: today ? "#F7F7FE" : "#F7F8FA",
                        padding: "6px 4px 5px",
                        fontSize: 10,
                        fontWeight: 700,
                        color: today ? "var(--co-brand)" : "#5A6270",
                        borderBottom: "1px solid var(--co-line)",
                        borderRight: "1px solid var(--co-border-2)",
                        minWidth: 30,
                        lineHeight: 1.15,
                      }}
                      title={`${thDate(dt)} ${thWeekday(dt)}`}
                    >
                      <div>{dt.getDate()}</div>
                      <div style={{ fontSize: 8.5, fontWeight: 500, color: today ? "var(--co-brand)" : "var(--co-muted-3)" }}>{thWeekday(dt)}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const muted = !b.hasBaseline;
                const sm = summary.get(b.branchId);
                return (
                  <tr key={b.branchId} className="co-rowh" style={muted ? { opacity: 0.62 } : undefined}>
                    <th
                      style={{
                        position: "sticky",
                        left: 0,
                        zIndex: 1,
                        background: "var(--co-surface)",
                        padding: "8px 12px",
                        textAlign: "left",
                        fontSize: 12,
                        fontWeight: 600,
                        color: "var(--co-ink)",
                        borderBottom: "1px solid var(--co-border-2)",
                        borderRight: "1px solid var(--co-line)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{b.branchName}</span>
                        {muted ? (
                          <span
                            className="co-pill"
                            style={{ background: TONE.neutral.bg, color: TONE.neutral.text, fontSize: 9.5, fontWeight: 700, flex: "0 0 auto" }}
                          >
                            รอตั้งค่า
                          </span>
                        ) : sm && sm.total > 0 ? (
                          <span style={{ fontSize: 10, fontWeight: 600, color: "var(--co-muted-2)", flex: "0 0 auto" }}>
                            {sm.collected}/{sm.total}
                          </span>
                        ) : null}
                      </div>
                    </th>
                    {iso.map((d) => {
                      const st = b.byDay[d] ?? "NOT_COLLECTED";
                      return (
                        <td key={d} style={CELL} title={`${b.branchName} · ${thDate(isoToDate(d))} — ${DOT[st].label}`}>
                          <StatusDot status={st} />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
