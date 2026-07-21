"use client";

/**
 * รายงานตู้ 7-11 (Fleet 711) — client view. 2 แท็บ: รายตู้ / รายงานสรุป.
 * ทุกตัวเลขมาจาก props (server คำนวณจริงจาก cf_collection_events) — client แค่ filter/สรุป/จัดสี.
 * State ทั้งหมด client-side ไม่ persist (tab/period/day/mxScale/mxMetric) เหมือน mockup.
 *
 * สี/แบนด์เฉลี่ยต่อตัว (bandPure) ใช้เกณฑ์ของหน้า 7-11 ตาม mockup (130/230) เพื่อให้ "หน้าตา" ตรง 100%.
 * (คนละชุดกับ pnl-queries 180/280 ที่เป็นเกณฑ์ P&L — ตรงนี้เป็น band แสดงผลล้วน ไม่ใช่ money math)
 */

import { useMemo, useState } from "react";
import { Search, Calendar, ChevronDown, PackageOpen } from "lucide-react";
import { EmptyState } from "@/components/clawfleet/os/kit";
import { num, thDate, thWeekday } from "@/components/clawfleet/os/format";

// ── types (serialized จาก server) ─────────────────────────────────────────
export type Fleet711Machine = {
  machineId: string;
  code: string;
  loc: string;
  status: "ok" | "refill" | "broken";
  /** รายได้ 7 วัน (บาท · COLLECTION-only) */
  revenue: number;
  /** ตุ๊กตาออก 7 วัน */
  dolls: number;
  /** เฉลี่ยบาท/ตัว 7 วัน (null = ไม่มีตุ๊กตาออก) */
  avg: number | null;
  lastLabel: string;
  /** เงินตรงมิเตอร์ไหม (null = ตู้เสีย) */
  cashOk: boolean | null;
  /** ตุ๊กตาตรงมิเตอร์ไหม (null = ตู้เสีย) */
  dollOk: boolean | null;
  /** เงิน/ตุ๊กตา รายวัน (key = ISO "YYYY-MM-DD" เวลาไทย) */
  days: Record<string, { cash: number; dolls: number }>;
};

type Props = {
  machines: Fleet711Machine[];
  /** ISO days ใหม่→เก่า (index 0 = วันล่าสุด) */
  isoDays: string[];
  /** "18–24 มิ.ย. 69" */
  rangeLabel: string;
};

// ── display helpers (ตรงกับ mockup) ────────────────────────────────────────
const money = (n: number) => "฿" + Math.round(n).toLocaleString("en-US");
const TH_MON_FULL = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];
const TH_MON_SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** band สีเฉลี่ยบาท/ตัว — เกณฑ์หน้า 7-11 (mockup) */
function bandPure(avg: number): { color: string; bg: string } {
  if (avg <= 0) return { color: "#5A6270", bg: "#F1F2F7" };
  if (avg < 130) return { color: "#B45309", bg: "#FCF1E2" };
  if (avg > 230) return { color: "#B42318", bg: "#FCEDEC" };
  return { color: "#15803D", bg: "#E7F4EC" };
}

const F_STATUS = {
  ok: { l: "ปกติ", c: "#15803D", bg: "#E7F4EC" },
  refill: { l: "ต้องเติม", c: "#B45309", bg: "#FCF1E2" },
  broken: { l: "ตู้เสีย", c: "#B42318", bg: "#FCEDEC" },
} as const;

function matchBadge(ok: boolean | null): { l: string; c: string; bg: string } {
  if (ok === null) return { l: "—", c: "#9AA1AB", bg: "#F1F2F7" };
  return ok ? { l: "ตรง", c: "#15803D", bg: "#E7F4EC" } : { l: "ไม่ตรง", c: "#B42318", bg: "#FCEDEC" };
}

function parseIso(iso: string): Date {
  return new Date(iso + "T00:00:00+07:00");
}
function beYear2(iso: string): number {
  return (Number(iso.slice(0, 4)) + 543) % 100;
}

// pill button (แท็บ / toggle) — style ตาม mockup
function pillBtn(active: boolean, activeBg: string, radius: number, fontSize: number, pad: string): React.CSSProperties {
  return {
    border: "none",
    cursor: "pointer",
    fontSize,
    fontWeight: 600,
    padding: pad,
    borderRadius: radius,
    background: active ? activeBg : "transparent",
    color: active ? "#fff" : "#6B7280",
  };
}

export function Client711({ machines, isoDays, rangeLabel }: Props) {
  const [tab, setTab] = useState<"fleet" | "report">("fleet");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<"day" | "month">("day");
  const [day, setDay] = useState<string | null>(null);
  const [mxScale, setMxScale] = useState<"day" | "month">("day");
  const [mxMetric, setMxMetric] = useState<"cash" | "dolls" | "avg">("cash");

  const hasData = machines.length > 0 && isoDays.length > 0;

  // ── fleet KPIs ──────────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const total = machines.length;
    const rev7 = machines.reduce((a, m) => a + m.revenue, 0);
    const refill = machines.filter((m) => m.status === "refill").length;
    const broken = machines.filter((m) => m.status === "broken").length;
    return { total, rev7, refill, broken };
  }, [machines]);

  // ── fleet filter (search) ───────────────────────────────────────────────
  const fleet = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return machines;
    return machines.filter((m) => m.code.toLowerCase().includes(q) || m.loc.toLowerCase().includes(q));
  }, [machines, search]);

  // ── report: ตู้ที่รายงาน = ไม่รวมตู้เสีย ─────────────────────────────────
  const rptMachines = useMemo(() => machines.filter((m) => m.status !== "broken"), [machines]);

  // last 7 ISO days (ใหม่→เก่า) สำหรับ periodRows รายวัน + drill
  const last7 = useMemo(() => isoDays.slice(0, 7), [isoDays]);

  // เดือน (YYYY-MM) จาก isoDays — ใหม่→เก่า
  const months = useMemo(() => {
    const seen: string[] = [];
    for (const iso of isoDays) {
      const ym = iso.slice(0, 7);
      if (!seen.includes(ym)) seen.push(ym);
    }
    return seen; // ใหม่→เก่า
  }, [isoDays]);

  // ── periodRows (สรุป transaction ต่อช่วง) ────────────────────────────────
  const periodRows = useMemo(() => {
    if (period === "day") {
      return last7.map((iso) => {
        let cash = 0, dolls = 0, active = 0;
        for (const m of rptMachines) {
          const c = m.days[iso];
          if (c && c.cash > 0) { cash += c.cash; dolls += c.dolls; active++; }
        }
        const avg = dolls > 0 ? Math.round(cash / dolls) : 0;
        const d = parseIso(iso);
        return {
          key: iso,
          label: `${thWeekday(d)} ${thDate(d)}`,
          cash, dolls, avg,
          activeLabel: `${active}/${rptMachines.length} ตู้`,
          isDay: true,
        };
      });
    }
    // รายเดือน — 3 เดือนล่าสุด
    return months.slice(0, 3).map((ym) => {
      let cash = 0, dolls = 0;
      for (const m of rptMachines) {
        for (const [iso, c] of Object.entries(m.days)) {
          if (iso.slice(0, 7) === ym && c.cash > 0) { cash += c.cash; dolls += c.dolls; }
        }
      }
      const avg = dolls > 0 ? Math.round(cash / dolls) : 0;
      const mi = Number(ym.slice(5, 7)) - 1;
      return {
        key: ym,
        label: `${TH_MON_FULL[mi]} ${beYear2(ym + "-01")}`,
        cash, dolls, avg,
        activeLabel: `${rptMachines.length} ตู้`,
        isDay: false,
      };
    });
  }, [period, last7, months, rptMachines]);

  const sum = useMemo(() => {
    const cash = periodRows.reduce((a, r) => a + r.cash, 0);
    const dolls = periodRows.reduce((a, r) => a + r.dolls, 0);
    return {
      cash: money(cash),
      dolls: num(dolls),
      periodLabel: period === "day" ? "7 วันล่าสุด" : `${periodRows.length} เดือนล่าสุด`,
      machines: `${rptMachines.length} ตู้`,
    };
  }, [periodRows, period, rptMachines]);

  // ── drill: รายตู้ต่อวันที่เลือก ──────────────────────────────────────────
  const dayDetail = useMemo(() => {
    if (period !== "day" || !day) return null;
    const d = parseIso(day);
    const rows = rptMachines.map((m) => {
      const c = m.days[day];
      const cash = c?.cash ?? 0, dolls = c?.dolls ?? 0;
      const avg = dolls > 0 ? Math.round(cash / dolls) : 0;
      const bp = bandPure(avg);
      return {
        code: m.code, loc: m.loc,
        cashLabel: cash > 0 ? money(cash) : "—",
        dollsLabel: dolls > 0 ? String(dolls) : "—",
        avgLabel: cash > 0 ? (avg > 0 ? "฿" + avg : "—") : "ไม่เก็บ",
        avgColor: cash > 0 ? bp.color : "#9AA1AB",
        avgBg: cash > 0 ? bp.bg : "#F1F2F7",
        dim: cash === 0 ? 0.5 : 1,
      };
    });
    let total = 0, count = 0;
    for (const m of rptMachines) {
      const c = m.days[day];
      if (c && c.cash > 0) { total += c.cash; count++; }
    }
    return { label: `${thWeekday(d)} ${thDate(d)}`, rows, total: money(total), count };
  }, [period, day, rptMachines]);

  // ── matrix (เปรียบเทียบทุกตู้ × วัน/เดือน) ───────────────────────────────
  const matrix = useMemo(() => {
    // คอลัมน์
    let cols: { key: string; short: string }[];
    if (mxScale === "day") {
      // 30 วันล่าสุด · เรียงเก่า→ใหม่ (ซ้าย→ขวา)
      const d30 = isoDays.slice(0, 30).slice().reverse();
      cols = d30.map((iso) => ({ key: iso, short: String(Number(iso.slice(8, 10))) }));
    } else {
      // 12 เดือนล่าสุด · เก่า→ใหม่
      const m12 = months.slice(0, 12).slice().reverse();
      cols = m12.map((ym) => ({ key: ym, short: TH_MON_SHORT[Number(ym.slice(5, 7)) - 1] }));
    }

    // ค่า cash/dolls ต่อ (ตู้, คอลัมน์)
    const cellVal = (m: Fleet711Machine, colKey: string): { cash: number; dolls: number } => {
      if (mxScale === "day") {
        const c = m.days[colKey];
        return { cash: c?.cash ?? 0, dolls: c?.dolls ?? 0 };
      }
      let cash = 0, dolls = 0;
      for (const [iso, c] of Object.entries(m.days)) {
        if (iso.slice(0, 7) === colKey) { cash += c.cash; dolls += c.dolls; }
      }
      return { cash, dolls };
    };

    const fmtMetric = (cash: number, dolls: number): string => {
      if (mxMetric === "cash") return money(cash);
      if (mxMetric === "dolls") return num(dolls);
      return dolls > 0 ? "฿" + Math.round(cash / dolls) : "—";
    };

    const cellStyle = (cash: number, dolls: number): { v: string; bg: string; color: string } => {
      if (cash <= 0) return { v: "—", bg: "#FBFBFC", color: "#C7CBD1" };
      if (mxMetric === "cash") {
        const hi = mxScale === "day" ? 600 : 12000, mid = mxScale === "day" ? 360 : 8000;
        return { v: money(cash), bg: cash >= hi ? "#E7F4EC" : cash >= mid ? "#FCF9EC" : "#FDF3F1", color: "#31363E" };
      }
      if (mxMetric === "dolls") {
        const hi = mxScale === "day" ? 3 : 60;
        return { v: num(dolls), bg: dolls >= hi ? "#E7F4EC" : dolls >= hi / 2 ? "#FCF9EC" : "#FDF3F1", color: "#31363E" };
      }
      const avg = dolls > 0 ? Math.round(cash / dolls) : 0;
      const bp = bandPure(avg);
      return { v: avg > 0 ? "฿" + avg : "—", bg: bp.bg, color: bp.color };
    };

    const rows = rptMachines.map((m) => {
      let totCash = 0, totDolls = 0, active = 0;
      const cells = cols.map((col) => {
        const { cash, dolls } = cellVal(m, col.key);
        totCash += cash; totDolls += dolls;
        if (cash > 0) active++;
        return cellStyle(cash, dolls);
      });
      return {
        code: m.code,
        loc: m.loc,
        cells,
        total: fmtMetric(totCash, totDolls),
        days: `${active}/${cols.length}`,
      };
    });

    // footer รวมต่อคอลัมน์ + grand total
    const footer = cols.map((col) => {
      let cash = 0, dolls = 0;
      for (const m of rptMachines) { const v = cellVal(m, col.key); cash += v.cash; dolls += v.dolls; }
      return fmtMetric(cash, dolls);
    });
    let gCash = 0, gDolls = 0;
    for (const m of rptMachines) for (const col of cols) { const v = cellVal(m, col.key); gCash += v.cash; gDolls += v.dolls; }
    const grand = fmtMetric(gCash, gDolls);
    const footLabel = mxMetric === "cash" ? "รวมเงินต่อวัน" : mxMetric === "dolls" ? "ตุ๊กตาออกต่อวัน" : "เฉลี่ย/ตัวต่อวัน";

    const cellMin = mxScale === "day" ? 40 : 58;
    const colTmpl = `150px repeat(${cols.length}, minmax(${cellMin}px,1fr)) 78px`;
    const minW = 150 + 78 + cols.length * cellMin;
    return { cols, rows, footer, grand, footLabel, colTmpl, minW };
  }, [isoDays, months, mxScale, mxMetric, rptMachines]);

  // ── empty ────────────────────────────────────────────────────────────────
  if (!hasData) {
    return (
      <EmptyState
        icon={<PackageOpen size={28} strokeWidth={1.6} />}
        title="ยังไม่มีข้อมูลตู้ 7-11"
        sub="เมื่อมีสาขา+ตู้และเริ่มเก็บเงินแล้ว รายงานตู้ 7-11 จะแสดงที่นี่"
      />
    );
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* tabs รายตู้ / รายงานสรุป */}
      <div style={{ display: "inline-flex", background: "#fff", border: "1px solid #E8EAED", borderRadius: 12, padding: 4, marginBottom: 18 }}>
        {([["fleet", "รายตู้"], ["report", "รายงานสรุป"]] as const).map(([id, label]) => (
          <button key={id} className="co-pbtn" onClick={() => setTab(id)} style={pillBtn(tab === id, "#1A1D21", 9, 13, "8px 18px")}>
            {label}
          </button>
        ))}
      </div>

      {tab === "fleet" && (
        <div>
          {/* KPI 4 ใบ */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 18 }}>
            <KpiCard label="ตู้ทั้งหมด" value={`${num(kpi.total)} ตู้`} />
            <KpiCard label="รายได้ 7 วัน" value={money(kpi.rev7)} />
            <KpiCard label="ต้องเติมตุ๊กตา" value={`${num(kpi.refill)} ตู้`} color="#B45309" />
            <KpiCard label="ตู้เสีย/ต้องตรวจ" value={`${num(kpi.broken)} ตู้`} color="#B42318" />
          </div>

          {/* ตาราง fleet */}
          <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, overflow: "hidden" }}>
            {/* toolbar */}
            <div style={{ padding: "14px 20px", borderBottom: "1px solid #F0F1F4", display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 9, background: "#F5F6F8", border: "1px solid #E8EAED", borderRadius: 9, padding: "8px 12px", maxWidth: 320 }}>
                <Search size={15} strokeWidth={2} color="#9AA1AB" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ค้นด้วยรหัสตู้ หรือทำเล…"
                  style={{ border: "none", outline: "none", background: "transparent", fontSize: 13, color: "#31363E", width: "100%" }}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, background: "#fff", border: "1px solid #E3E6EA", borderRadius: 9, padding: "7px 11px" }}>
                <Calendar size={14} strokeWidth={2} color="#6B7280" />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#454B54" }}>{rangeLabel || "7 วันล่าสุด"}</span>
                <ChevronDown size={13} strokeWidth={2} color="#9AA1AB" />
              </div>
              <span style={{ fontSize: 12, color: "#9AA1AB" }}>แสดง {num(fleet.length)} จาก {num(machines.length)} ตู้</span>
            </div>

            {/* header */}
            <div style={{ display: "grid", gridTemplateColumns: FLEET_COLS, padding: "10px 20px", fontSize: 11, fontWeight: 600, color: "#9AA1AB", borderBottom: "1px solid #F4F5F7" }}>
              <span>รหัสตู้</span><span>ทำเล</span><span>สถานะ</span>
              <span style={{ textAlign: "right" }}>รายได้</span>
              <span style={{ textAlign: "right" }}>ตุ๊กตาออก</span>
              <span style={{ textAlign: "right" }}>อัตราออก</span>
              <span style={{ textAlign: "center" }}>เงินตรง</span>
              <span style={{ textAlign: "center" }}>ตุ๊กตาตรง</span>
              <span style={{ textAlign: "right" }}>เก็บล่าสุด</span>
            </div>

            {/* rows */}
            {fleet.map((m) => {
              const broken = m.status === "broken";
              const ss = F_STATUS[m.status];
              const avg = m.avg ?? 0;
              const bp = bandPure(broken ? 0 : avg);
              const cb = matchBadge(m.cashOk), db = matchBadge(m.dollOk);
              return (
                <div key={m.machineId} className="co-rowh" style={{ display: "grid", gridTemplateColumns: FLEET_COLS, padding: "13px 20px", alignItems: "center", borderBottom: "1px solid #F4F5F7", fontSize: 13 }}>
                  <span className="num" style={{ fontWeight: 700, color: "#4F46E5" }}>{m.code}</span>
                  <span style={{ fontWeight: 500 }}>{m.loc}</span>
                  <span>
                    <span style={{ display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 20, background: ss.bg, color: ss.c }}>{ss.l}</span>
                  </span>
                  <span className="num" style={{ textAlign: "right", fontWeight: 600 }}>{broken || m.revenue <= 0 ? "—" : money(m.revenue)}</span>
                  <span className="num" style={{ textAlign: "right" }}>{broken || m.dolls <= 0 ? "—" : num(m.dolls)}</span>
                  <span style={{ textAlign: "right" }}>
                    <span className="num" style={{ fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: bp.bg, color: bp.color }}>
                      {broken || avg <= 0 ? "—" : "฿" + avg}
                    </span>
                  </span>
                  <span style={{ textAlign: "center" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: cb.bg, color: cb.c }}>{cb.l}</span>
                  </span>
                  <span style={{ textAlign: "center" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: db.bg, color: db.c }}>{db.l}</span>
                  </span>
                  <span style={{ textAlign: "right", fontSize: 11, color: "#9AA1AB" }}>{m.lastLabel}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "report" && (
        <div>
          {/* period toggle + label */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ display: "inline-flex", background: "#fff", border: "1px solid #E8EAED", borderRadius: 11, padding: 4 }}>
              {([["day", "รายวัน"], ["month", "รายเดือน"]] as const).map(([id, label]) => (
                <button key={id} className="co-pbtn" onClick={() => { setPeriod(id); setDay(null); }} style={pillBtn(period === id, "#4F46E5", 8, 12.5, "7px 16px")}>
                  {label}
                </button>
              ))}
            </div>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 12, color: "#9AA1AB" }}>{sum.periodLabel} · {sum.machines}</span>
          </div>

          {/* summary 3 cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 18 }}>
            <div style={{ background: "#1E2230", borderRadius: 14, padding: "16px 18px", color: "#fff" }}>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginBottom: 8 }}>เก็บเงินรวม · {sum.periodLabel}</div>
              <div className="num" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.5px" }}>{sum.cash}</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, padding: "16px 18px" }}>
              <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 8 }}>ตุ๊กตาออกรวม</div>
              <div className="num" style={{ fontSize: 26, fontWeight: 700 }}>{sum.dolls}</div>
            </div>
            <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, padding: "16px 18px" }}>
              <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 8 }}>ตู้ที่รายงาน</div>
              <div className="num" style={{ fontSize: 26, fontWeight: 700, color: "#4F46E5" }}>{rptMachines.length}</div>
            </div>
          </div>

          {/* periodRows table */}
          <div style={{ fontSize: 12, fontWeight: 700, color: "#454B54", margin: "0 2px 9px" }}>สรุป transaction ต่อ{period === "day" ? "วัน" : "เดือน"}</div>
          <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, overflow: "hidden", marginBottom: 22 }}>
            <div style={{ display: "grid", gridTemplateColumns: PERIOD_COLS, padding: "11px 20px", background: "#FAFBFC", borderBottom: "1px solid #EDEFF2", fontSize: 11, fontWeight: 700, color: "#9AA1AB" }}>
              <span>ช่วงเวลา</span>
              <span style={{ textAlign: "right" }}>เก็บเงินได้</span>
              <span style={{ textAlign: "right" }}>ตุ๊กตาออก</span>
              <span style={{ textAlign: "right" }}>เฉลี่ย/ตัว</span>
              <span />
            </div>
            {periodRows.map((r) => {
              const bp = bandPure(r.avg);
              const clickable = r.isDay;
              return (
                <div
                  key={r.key}
                  className={clickable ? "co-rowh" : undefined}
                  onClick={clickable ? () => setDay(day === r.key ? null : r.key) : undefined}
                  style={{ display: "grid", gridTemplateColumns: PERIOD_COLS, padding: "13px 20px", alignItems: "center", borderBottom: "1px solid #F4F5F7", fontSize: 13, cursor: clickable ? "pointer" : "default", background: day === r.key ? "#FAFBFF" : undefined }}
                >
                  <span style={{ fontWeight: 600 }}>{r.label}</span>
                  <span className="num" style={{ textAlign: "right", fontWeight: 700, color: "#15803D" }}>{money(r.cash)}</span>
                  <span className="num" style={{ textAlign: "right" }}>{num(r.dolls)}</span>
                  <span style={{ textAlign: "right" }}>
                    <span className="num" style={{ fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: bp.bg, color: bp.color }}>{r.avg > 0 ? "฿" + r.avg : "—"}</span>
                  </span>
                  <span style={{ textAlign: "right", fontSize: 11, color: "#9AA1AB" }}>{r.activeLabel}</span>
                </div>
              );
            })}
          </div>

          {/* drill: รายตู้ต่อวัน */}
          {dayDetail && (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#454B54", margin: "0 2px 9px" }}>
                รายตู้ · {dayDetail.label} <span style={{ color: "#9AA1AB", fontWeight: 500 }}>· เก็บได้ {dayDetail.total} · {dayDetail.count} ตู้</span>
              </div>
              <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, overflow: "hidden", marginBottom: 22 }}>
                <div style={{ display: "grid", gridTemplateColumns: DRILL_COLS, padding: "10px 20px", background: "#FAFBFC", borderBottom: "1px solid #EDEFF2", fontSize: 11, fontWeight: 700, color: "#9AA1AB" }}>
                  <span>รหัส</span><span>ทำเล</span>
                  <span style={{ textAlign: "right" }}>เก็บเงิน</span>
                  <span style={{ textAlign: "right" }}>ตุ๊กตาออก</span>
                  <span style={{ textAlign: "right" }}>เฉลี่ย/ตัว</span>
                </div>
                {dayDetail.rows.map((r, i) => (
                  <div key={i} style={{ display: "grid", gridTemplateColumns: DRILL_COLS, padding: "11px 20px", alignItems: "center", borderBottom: "1px solid #F4F5F7", fontSize: 12.5, opacity: r.dim }}>
                    <span className="num" style={{ fontWeight: 700, color: "#4F46E5" }}>{r.code}</span>
                    <span>{r.loc}</span>
                    <span className="num" style={{ textAlign: "right", fontWeight: 600 }}>{r.cashLabel}</span>
                    <span className="num" style={{ textAlign: "right" }}>{r.dollsLabel}</span>
                    <span style={{ textAlign: "right" }}>
                      <span className="num" style={{ fontSize: 11.5, fontWeight: 600, padding: "2px 8px", borderRadius: 20, background: r.avgBg, color: r.avgColor }}>{r.avgLabel}</span>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* matrix toggles */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "0 2px 9px", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#454B54" }}>เปรียบเทียบทุกตู้พร้อมกัน</span>
            <span style={{ flex: 1 }} />
            <div style={{ display: "inline-flex", background: "#fff", border: "1px solid #E8EAED", borderRadius: 10, padding: 3 }}>
              {([["cash", "เงิน"], ["dolls", "ตุ๊กตาออก"], ["avg", "เฉลี่ย/ตัว"]] as const).map(([id, label]) => (
                <button key={id} className="co-pbtn" onClick={() => setMxMetric(id)} style={pillBtn(mxMetric === id, "#4F46E5", 8, 12, "6px 14px")}>{label}</button>
              ))}
            </div>
            <div style={{ display: "inline-flex", background: "#fff", border: "1px solid #E8EAED", borderRadius: 10, padding: 3 }}>
              {([["day", "30 วัน"], ["month", "ทั้งปี"]] as const).map(([id, label]) => (
                <button key={id} className="co-pbtn" onClick={() => setMxScale(id)} style={pillBtn(mxScale === id, "#1A1D21", 8, 12, "6px 14px")}>{label}</button>
              ))}
            </div>
          </div>

          {/* matrix table */}
          <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, overflow: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: matrix.colTmpl, minWidth: matrix.minW }}>
              {/* header row */}
              <div style={{ padding: "10px 14px", background: "#FAFBFC", borderBottom: "1px solid #EDEFF2", fontSize: 11, fontWeight: 700, color: "#9AA1AB", position: "sticky", left: 0, zIndex: 1 }}>ตู้ / ทำเล</div>
              {matrix.cols.map((c) => (
                <div key={c.key} style={{ padding: "10px 2px", background: "#FAFBFC", borderBottom: "1px solid #EDEFF2", fontSize: 10, fontWeight: 700, color: "#9AA1AB", textAlign: "center" }}>{c.short}</div>
              ))}
              <div style={{ padding: "10px 10px", background: "#F4F3FE", borderBottom: "1px solid #EDEFF2", fontSize: 11, fontWeight: 700, color: "#4F46E5", textAlign: "right" }}>รวม</div>

              {/* machine rows */}
              {matrix.rows.map((m, ri) => (
                <FragmentRow key={ri} m={m} />
              ))}

              {/* footer dark */}
              <div style={{ padding: "11px 14px", background: "#1E2230", fontSize: 11, fontWeight: 700, color: "#fff", position: "sticky", left: 0, zIndex: 1 }}>{matrix.footLabel}</div>
              {matrix.footer.map((v, i) => (
                <div key={i} className="num" style={{ padding: "11px 2px", background: "#1E2230", textAlign: "center", fontSize: 10.5, fontWeight: 700, color: "#fff" }}>{v}</div>
              ))}
              <div style={{ padding: "11px 10px", background: "#151821", textAlign: "right" }}>
                <div className="num" style={{ fontSize: 12.5, fontWeight: 800, color: "#fff" }}>{matrix.grand}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// grid templates (คงที่ · ตรงกับ mockup)
const FLEET_COLS = "0.6fr 1.25fr 0.8fr 0.7fr 0.8fr 0.8fr 0.7fr 0.7fr 0.9fr";
const PERIOD_COLS = "1.4fr 1fr 0.9fr 1fr 0.5fr";
const DRILL_COLS = "0.7fr 1.4fr 1fr 0.9fr 1fr";

function KpiCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, padding: "15px 17px" }}>
      <div style={{ fontSize: 12.5, color: "#6B7280", marginBottom: 8 }}>{label}</div>
      <div className="num" style={{ fontSize: 24, fontWeight: 700, color: color ?? "#1A1D21" }}>{value}</div>
    </div>
  );
}

/** แถวเมทริกซ์ 1 ตู้ (sticky รหัส + เซลล์ heat + ช่องรวม) */
function FragmentRow({ m }: { m: { code: string; loc: string; cells: { v: string; bg: string; color: string }[]; total: string; days: string } }) {
  return (
    <>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #F4F5F7", position: "sticky", left: 0, background: "#fff", zIndex: 1 }}>
        <div className="num" style={{ fontSize: 12, fontWeight: 700, color: "#4F46E5" }}>{m.code}</div>
        <div style={{ fontSize: 10, color: "#9AA1AB", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 130 }}>{m.loc}</div>
      </div>
      {m.cells.map((c, i) => (
        <div key={i} className="num" style={{ padding: "9px 2px", borderBottom: "1px solid #F4F5F7", textAlign: "center", fontSize: 10.5, fontWeight: 600, background: c.bg, color: c.color }}>{c.v}</div>
      ))}
      <div style={{ padding: "10px 10px", borderBottom: "1px solid #F4F5F7", textAlign: "right", background: "#FBFBFE" }}>
        <div className="num" style={{ fontSize: 12, fontWeight: 800 }}>{m.total}</div>
        <div className="num" style={{ fontSize: 9.5, color: "#9AA1AB" }}>{m.days}</div>
      </div>
    </>
  );
}
