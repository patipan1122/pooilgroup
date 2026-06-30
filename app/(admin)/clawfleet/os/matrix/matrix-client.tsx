"use client";

/**
 * รายงานเจาะสาขา (Matrix) — ตาราง ตู้ × รายวัน + drill modal รายตู้.
 * ข้อมูลในเมทริกซ์เป็น "ข้อมูลจริง" จาก cf_collection_events (ส่งมาจาก page.tsx ผ่าน prop `machines`):
 *   cash = ยอดเก็บ/วัน · dolls = ตุ๊กตาออก/วัน · cost = บาท/ตุ๊กตา (revenue/dolls) · swapped = มี refill วันนั้น
 * วันที่ใช้ "วันจริง" (เวลาไทย) ย้อนหลัง N วันจากวันนี้ (ส่งมาเป็น isoDays).
 * เปลี่ยนสาขา/ช่วงวัน → navigate (router) ให้ server ดึงข้อมูลจริงของชุดใหม่.
 * DB ว่าง (ไม่มีสาขา) → ใช้ SAMPLE deterministic เพื่อโชว์โครงหน้า + แบนเนอร์เตือน.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarX } from "lucide-react";
import { Modal, EmptyState } from "@/components/clawfleet/os/kit";
import { thDate, thWeekday } from "@/components/clawfleet/os/format";

export type MatrixBranch = { id: string; code: string; name: string; machines: number };

/** ค่ารายวันต่อตู้ (serialized จาก server · cost = null เมื่อไม่มีตุ๊กตาออก) */
export type MatrixSerialDay = { cash: number; dolls: number; cost: number | null; swapped: boolean };
/** ตู้ + map isoDay → ค่ารายวัน (เฉพาะวันที่มี event) */
export type MatrixSerialMachine = {
  machineId: string;
  code: string;
  nickname: string | null;
  days: Record<string, MatrixSerialDay>;
};

type Metric = "cost" | "cash" | "dolls" | "all";

/* ── สาขาตัวอย่าง (ใช้เมื่อ DB ว่าง) — code/ชื่อ/จำนวนตู้ จาก design ── */
const SAMPLE_BRANCHES: MatrixBranch[] = [
  { id: "s-RS", code: "RS", name: "รังสิต", machines: 12 },
  { id: "s-LP", code: "LP", name: "ลาดพร้าว", machines: 10 },
  { id: "s-BK", code: "BK", name: "บางแค", machines: 11 },
  { id: "s-BN", code: "BN", name: "บางนา", machines: 9 },
  { id: "s-NB", code: "NB", name: "นนทบุรี", machines: 8 },
  { id: "s-PT", code: "PT", name: "ปทุมธานี", machines: 10 },
  { id: "s-SP", code: "SP", name: "สมุทรปราการ", machines: 7 },
  { id: "s-MB", code: "MB", name: "มีนบุรี", machines: 9 },
];

/* แถบสีตามต้นทุน/ตัว (cost band): เขียว=กำลังดี · เหลือง=ถูก/ง่ายไป · แดง=แพง/ยากไป */
function costBand(v: number): { bg: string; co: string } {
  if (v < 180) return { bg: "#FCF1E2", co: "#B45309" }; // ถูก/ง่ายไป
  if (v > 280) return { bg: "#FCEDEC", co: "#B42318" }; // แพง/ยากไป
  return { bg: "#E7F4EC", co: "#15803D" }; // กำลังดี 180–280
}
function cashHeat(v: number): string {
  return `rgba(47,168,102,${(0.07 + Math.max(0, Math.min(1, (v - 280) / 520)) * 0.42).toFixed(2)})`;
}
function dollHeat(v: number): string {
  return `rgba(232,163,61,${(0.06 + Math.max(0, Math.min(1, (v - 4) / 22)) * 0.4).toFixed(2)})`;
}

/* ── SAMPLE generator (เฉพาะเมื่อ DB ว่าง) — deterministic, ไม่มี hydration mismatch ── */
function mrng(s: number): number {
  const x = Math.sin(s * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
type SampleSeed = { code: string; base: number; swapEvery: number; swapOff: number };
function sampleMachines(branchCode: string, n: number): SampleSeed[] {
  const seed0 = (branchCode.charCodeAt(0) || 65) + (branchCode.charCodeAt(1) || 65);
  return Array.from({ length: n }, (_, i) => ({
    code: `${branchCode}-${String(i + 1).padStart(2, "0")}`,
    base: 165 + Math.round(mrng(seed0 + i * 7 + 1) * 130),
    swapEvery: 9 + Math.round(mrng(seed0 + i * 3 + 2) * 13),
    swapOff: Math.round(mrng(seed0 + i * 5 + 3) * 12),
  }));
}
function sampleVals(seed0: number, m: SampleSeed, mi: number, d: number): MatrixSerialDay {
  const phase = (d + m.swapOff) % m.swapEvery;
  const cost = Math.max(95, m.base + Math.round((mrng(seed0 + mi * 31 + d * 7 + 1) - 0.5) * 46) - Math.round(phase * 1.1));
  return {
    cost,
    cash: 280 + Math.round(mrng(seed0 + mi * 17 + d * 5 + 2) * 520),
    dolls: 4 + Math.round(mrng(seed0 + mi * 13 + d * 11 + 3) * 22),
    swapped: phase === 0,
  };
}
/** สร้าง isoDays ตัวอย่าง (วันจริงย้อนหลัง · ใช้เฉพาะ sample path) */
function sampleIsoDays(n: number): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });
  const out: string[] = [];
  const now = Date.now();
  for (let i = 0; i < n; i++) out.push(fmt.format(new Date(now - i * 86_400_000)));
  return out;
}
/** parse "YYYY-MM-DD" → Date (เที่ยงวัน กัน DST/offset) สำหรับ label เท่านั้น */
function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0);
}

const METRICS: { key: Metric; label: string }[] = [
  { key: "cost", label: "ต้นทุน/ตัว" },
  { key: "cash", label: "ยอดเก็บ/วัน" },
  { key: "dolls", label: "ตุ๊กตาออก" },
  { key: "all", label: "รวม 3 ค่า" },
];
const METRIC_UNIT: Record<Metric, string> = {
  cost: "ต้นทุน/ตัว (บาท)",
  cash: "ยอดเก็บ/วัน (บาท)",
  dolls: "ตุ๊กตาออก (ตัว)",
  all: "ต้นทุน/ตัว · ยอดเก็บ · ตุ๊กตาออก",
};
const CELL_PAD: React.CSSProperties = {
  padding: "7px 6px",
  textAlign: "center",
  borderBottom: "1px solid #F0F1F4",
  borderRight: "1px solid #F4F5F7",
  whiteSpace: "nowrap",
  position: "relative",
};

type GridDay = MatrixSerialDay & { hasData: boolean };
type GridMachine = { code: string; days: GridDay[] };

export function MatrixClient({
  branches,
  initialBranch,
  isoDays,
  machines,
  days,
}: {
  branches: MatrixBranch[];
  initialBranch: string | null;
  isoDays: string[];
  machines: MatrixSerialMachine[];
  days: 20 | 30;
}) {
  const empty = branches.length === 0;
  const rows = empty ? SAMPLE_BRANCHES : branches;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const branchCode = useMemo(() => {
    const found = initialBranch && rows.find((b) => b.code === initialBranch);
    return found ? found.code : rows[0]?.code ?? "RS";
  }, [initialBranch, rows]);

  const [metric, setMetric] = useState<Metric>("cost");
  const [drillIdx, setDrillIdx] = useState<number | null>(null);

  const branch = rows.find((b) => b.code === branchCode) ?? rows[0];
  const machineCount = branch?.machines ?? 8;

  /** เปลี่ยนสาขา/ช่วง → navigate ให้ server ดึงข้อมูลจริงชุดใหม่ */
  const navigate = (nextBranch: string, nextDays: 20 | 30) => {
    const params = new URLSearchParams();
    params.set("branch", nextBranch);
    params.set("days", String(nextDays));
    startTransition(() => router.push(`/clawfleet/os/matrix?${params.toString()}`));
  };

  /* แถววัน (ใหม่→เก่า) + grid ค่าจริง (หรือ sample เมื่อ DB ว่าง) */
  const grid = useMemo(() => {
    // SAMPLE path — DB ว่าง: สร้าง deterministic จาก code (โชว์โครงหน้า)
    if (empty) {
      const seed0 = (branchCode.charCodeAt(0) || 65) + (branchCode.charCodeAt(1) || 65);
      const sIso = sampleIsoDays(days);
      const sMachines = sampleMachines(branchCode, machineCount);
      const gm: GridMachine[] = sMachines.map((m, mi) => ({
        code: m.code,
        days: sIso.map((_iso, di) => ({ ...sampleVals(seed0, m, mi, di), hasData: true })),
      }));
      return { iso: sIso, machines: gm };
    }
    // REAL path — เรียงวันตาม isoDays (ใหม่→เก่า) · เติมช่องว่าง = ไม่มีข้อมูล
    const gm: GridMachine[] = machines.map((m) => ({
      code: m.code,
      days: isoDays.map((iso) => {
        const d = m.days[iso];
        if (!d) return { cash: 0, dolls: 0, cost: null, swapped: false, hasData: false };
        return { ...d, hasData: true };
      }),
    }));
    return { iso: isoDays, machines: gm };
  }, [empty, branchCode, machineCount, days, isoDays, machines]);

  /* สร้างเมทริกซ์ที่ render ได้ (รายแถว=วัน · คอลัมน์=ตู้) + footer เฉลี่ยตู้ */
  const matrix = useMemo(() => {
    const cols = grid.machines.length;
    const colCost = new Array<number>(cols).fill(0);
    const colCash = new Array<number>(cols).fill(0);
    const colDoll = new Array<number>(cols).fill(0);
    const colCnt = new Array<number>(cols).fill(0);

    type Cell = { rows: { v: string; style: React.CSSProperties }[]; swapped: boolean; style: React.CSSProperties };
    const dayRows: { dateLabel: string; wd: string; cells: Cell[]; avg: string }[] = [];

    grid.iso.forEach((iso, di) => {
      const dt = isoToDate(iso);
      let daySum = 0;
      let dayCnt = 0;
      const cells: Cell[] = grid.machines.map((gm, mi) => {
        const rv = gm.days[di];
        if (!rv || !rv.hasData) {
          return {
            rows: [{ v: "—", style: { color: "#B6BBC4" } }],
            swapped: false,
            style: { ...CELL_PAD, background: "#F4F5F7", color: "#B6BBC4" },
          };
        }
        // cost = null (ไม่มีตุ๊กตาออก) → ถือเป็น 0 สำหรับ band/heat แต่โชว์ "—" ในโหมด cost
        const costVal = rv.cost ?? 0;
        colCost[mi] += costVal;
        colCash[mi] += rv.cash;
        colDoll[mi] += rv.dolls;
        colCnt[mi] += 1;
        const cb = costBand(costVal);
        let bg: string;
        let cellRows: { v: string; style: React.CSSProperties }[];
        let primary: number;
        if (metric === "cash") {
          bg = cashHeat(rv.cash);
          primary = rv.cash;
          cellRows = [{ v: `฿${rv.cash}`, style: { fontWeight: 600, color: "#1A1D21" } }];
        } else if (metric === "dolls") {
          bg = dollHeat(rv.dolls);
          primary = rv.dolls;
          cellRows = [{ v: String(rv.dolls), style: { fontWeight: 600, color: "#1A1D21" } }];
        } else if (metric === "all") {
          bg = cb.bg;
          primary = costVal;
          cellRows = [
            { v: rv.cost == null ? "—" : `฿${rv.cost}`, style: { fontWeight: 700, color: cb.co, fontSize: 11.5 } },
            { v: `฿${rv.cash}`, style: { fontWeight: 500, color: "#15803D", fontSize: 10.5 } },
            { v: `${rv.dolls} ตัว`, style: { fontWeight: 500, color: "#B45309", fontSize: 10.5 } },
          ];
        } else {
          bg = cb.bg;
          primary = costVal;
          cellRows = [{ v: rv.cost == null ? "—" : `฿${rv.cost}`, style: { fontWeight: rv.swapped ? 700 : 600, color: cb.co } }];
        }
        daySum += primary;
        dayCnt += 1;
        return {
          rows: cellRows,
          swapped: rv.swapped,
          style: {
            ...CELL_PAD,
            background: bg,
            ...(rv.swapped ? { boxShadow: "inset 0 0 0 2px #4F46E5" } : {}),
          },
        };
      });
      const avgv = dayCnt ? Math.round(daySum / dayCnt) : 0;
      dayRows.push({
        dateLabel: thDate(dt),
        wd: thWeekday(dt),
        cells,
        avg: metric === "dolls" ? String(avgv) : `฿${avgv}`,
      });
    });

    const footer = grid.machines.map((_gm, mi) => {
      const cnt = colCnt[mi] || 1;
      const aCost = Math.round(colCost[mi] / cnt);
      const aCash = Math.round(colCash[mi] / cnt);
      const aDoll = Math.round(colDoll[mi] / cnt);
      const cb = costBand(aCost);
      let bg = "#fff";
      let frows: { v: string; style: React.CSSProperties }[];
      if (metric === "cash") {
        frows = [{ v: `฿${aCash}`, style: { fontWeight: 700, color: "#454B54" } }];
      } else if (metric === "dolls") {
        frows = [{ v: String(aDoll), style: { fontWeight: 700, color: "#454B54" } }];
      } else if (metric === "all") {
        bg = cb.bg;
        frows = [
          { v: `฿${aCost}`, style: { fontWeight: 700, color: cb.co, fontSize: 11 } },
          { v: `฿${aCash}`, style: { color: "#15803D", fontSize: 10 } },
          { v: `${aDoll} ตัว`, style: { color: "#B45309", fontSize: 10 } },
        ];
      } else {
        bg = cb.bg;
        frows = [{ v: `฿${aCost}`, style: { fontWeight: 700, color: cb.co } }];
      }
      return { rows: frows, style: { ...CELL_PAD, background: bg, borderTop: "2px solid #DDE0E6" } };
    });

    return { dayRows, footer };
  }, [grid, metric]);

  /* drill รายตู้ */
  const drill = useMemo(() => {
    if (drillIdx == null || drillIdx >= grid.machines.length) return null;
    const gm = grid.machines[drillIdx];
    let sc = 0;
    let sh = 0;
    let sd = 0;
    let cntCost = 0;
    let cntAll = 0;
    let swaps = 0;
    let lastSwap: number | null = null;
    const drows: {
      date: string;
      wd: string;
      cost: string;
      costColor: string;
      cash: string;
      dolls: string;
      swapped: boolean;
      rowStyle: React.CSSProperties;
    }[] = [];
    grid.iso.forEach((iso, di) => {
      const dt = isoToDate(iso);
      const rv = gm.days[di];
      if (!rv || !rv.hasData) {
        drows.push({
          date: thDate(dt),
          wd: thWeekday(dt),
          cost: "—",
          costColor: "#B6BBC4",
          cash: "—",
          dolls: "—",
          swapped: false,
          rowStyle: { borderBottom: "1px solid #F0F1F4", background: "#F8F9FB", color: "#B6BBC4" },
        });
        return;
      }
      if (rv.swapped) {
        swaps += 1;
        if (lastSwap == null) lastSwap = di;
      }
      if (rv.cost != null) { sc += rv.cost; cntCost += 1; }
      sh += rv.cash;
      sd += rv.dolls;
      cntAll += 1;
      const cb = costBand(rv.cost ?? 0);
      drows.push({
        date: thDate(dt),
        wd: thWeekday(dt),
        cost: rv.cost == null ? "—" : `฿${rv.cost}`,
        costColor: cb.co,
        cash: `฿${rv.cash}`,
        dolls: String(rv.dolls),
        swapped: rv.swapped,
        rowStyle: { borderBottom: "1px solid #F0F1F4", ...(rv.swapped ? { background: "#EEF0FE" } : {}) },
      });
    });
    const denomAll = cntAll || 1;
    return {
      code: gm.code,
      branch: branch?.name ?? "",
      avgCost: cntCost > 0 ? `฿${Math.round(sc / cntCost)}` : "—",
      avgCash: `฿${Math.round(sh / denomAll)}`,
      avgDoll: String(Math.round(sd / denomAll)),
      swaps: String(swaps),
      lastSwap: lastSwap == null ? "ไม่พบ" : lastSwap === 0 ? "วันนี้" : `${lastSwap} วันก่อน`,
      rows: drows,
    };
  }, [drillIdx, grid, branch]);

  const noData = !empty && grid.machines.length === 0;

  return (
    <div style={{ opacity: pending ? 0.6 : 1, transition: "opacity .15s" }}>
      {empty && (
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            background: "#FCF8EC",
            border: "1px solid #F0E2BE",
            borderRadius: 10,
            padding: "9px 14px",
            marginBottom: 16,
            fontSize: 12,
            color: "#7A5510",
          }}
        >
          <AlertTriangle size={15} /> ยังไม่มีข้อมูลจริง — กำลังแสดง<b>&nbsp;ตัวอย่าง&nbsp;</b>เพื่อให้เห็นภาพรายงาน
          (ตารางเจาะลึก ตู้×วัน รอเชื่อมข้อมูลจริงภายหลัง)
        </div>
      )}

      <div style={{ fontSize: 12, color: "#8A909A", marginBottom: 9 }}>
        เลือกสาขาเพื่อดูตารางเจาะลึก — ทุกตู้ × รายวันย้อนหลังในหน้าเดียว
      </div>

      {/* branch chips */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 18 }}>
        {rows.map((b) => {
          const on = b.code === branchCode;
          return (
            <button
              key={b.id}
              onClick={() => {
                setDrillIdx(null);
                if (!empty) navigate(b.code, days);
              }}
              style={{
                whiteSpace: "nowrap",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                padding: "7px 13px",
                borderRadius: 8,
                background: on ? "#4F46E5" : "#fff",
                color: on ? "#fff" : "#5A6270",
                border: `1px solid ${on ? "#4F46E5" : "#E3E6EA"}`,
              }}
            >
              {b.code} · {b.name}
            </button>
          );
        })}
      </div>

      {/* title + metric toggle + range toggle */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>
          {branch?.name} · {machineCount} ตู้
        </div>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "#9AA1AB" }}>ค่าในช่อง</span>
        <div style={{ display: "flex", background: "#fff", border: "1px solid #E3E6EA", borderRadius: 9, padding: 3 }}>
          {METRICS.map((mt) => {
            const on = mt.key === metric;
            return (
              <button
                key={mt.key}
                onClick={() => setMetric(mt.key)}
                style={{
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "6px 13px",
                  borderRadius: 7,
                  background: on ? "#4F46E5" : "transparent",
                  color: on ? "#fff" : "#6B7280",
                }}
              >
                {mt.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", background: "#fff", border: "1px solid #E3E6EA", borderRadius: 9, padding: 3 }}>
          {([20, 30] as const).map((n) => {
            const on = n === days;
            return (
              <button
                key={n}
                onClick={() => {
                  if (n !== days) navigate(branchCode, n);
                }}
                style={{
                  border: "none",
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "6px 13px",
                  borderRadius: 7,
                  background: on ? "#4F46E5" : "transparent",
                  color: on ? "#fff" : "#6B7280",
                }}
              >
                {n} วัน
              </button>
            );
          })}
        </div>
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
          color: "#6B7280",
        }}
      >
        <span className="co-eyebrow" style={{ marginRight: 2 }}>แถบสีต้นทุน/ตัว</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 13, height: 13, borderRadius: 4, border: "2px solid #4F46E5", display: "inline-block" }} />
          วันที่เปลี่ยนตุ๊กตา
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 13, height: 13, borderRadius: 4, background: "#FCF1E2", display: "inline-block" }} />
          ถูก/ง่ายไป <span className="num" style={{ color: "#A9AEB8" }}>&lt;฿180</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 13, height: 13, borderRadius: 4, background: "#E7F4EC", display: "inline-block" }} />
          กำลังดี <span className="num" style={{ color: "#A9AEB8" }}>฿180–280</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 13, height: 13, borderRadius: 4, background: "#FCEDEC", display: "inline-block" }} />
          แพง/ยากไป <span className="num" style={{ color: "#A9AEB8" }}>&gt;฿280</span>
        </span>
        <span style={{ flex: 1 }} />
        <span>หน่วย: {METRIC_UNIT[metric]}</span>
      </div>

      {/* sub-legend เมื่อโหมด "รวม 3 ค่า" */}
      {metric === "all" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            margin: "-4px 0 12px",
            fontSize: 11,
            color: "#8A909A",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "#4F46E5", display: "inline-block" }} />
            บรรทัดบน: ต้นทุน/ตัว
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "#15803D", display: "inline-block" }} />
            กลาง: ยอดเก็บ
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "#B45309", display: "inline-block" }} />
            ล่าง: ตุ๊กตาออก
          </span>
        </div>
      )}

      {noData && (
        <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14 }}>
          <EmptyState
            icon={<CalendarX size={28} />}
            title="ไม่มีรอบปิดในช่วงนี้"
            sub="สาขานี้ยังไม่มีตู้คีบ หรือยังไม่มีรอบเก็บที่ปิดแล้วในช่วงวันที่เลือก — ลองขยายเป็น 30 วัน"
          />
        </div>
      )}

      {/* the matrix table — sticky first col (dates) + sticky header (machine codes) */}
      {!noData && (
      <div style={{ background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ overflow: "auto", maxHeight: "60vh" }}>
          <table className="num" style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", fontSize: 12 }}>
            <thead>
              <tr>
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    left: 0,
                    zIndex: 3,
                    background: "#EEF0F4",
                    padding: "9px 12px",
                    textAlign: "left",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#5A6270",
                    borderBottom: "1px solid #E3E6EA",
                    borderRight: "1px solid #E3E6EA",
                    minWidth: 96,
                  }}
                >
                  วันที่
                </th>
                {grid.machines.map((gm, i) => (
                  <th
                    key={gm.code}
                    onClick={() => setDrillIdx(i)}
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 2,
                      background: "#F7F8FA",
                      padding: "8px 8px 6px",
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#4F46E5",
                      borderBottom: "1px solid #E3E6EA",
                      borderRight: "1px solid #F0F1F4",
                      minWidth: 66,
                      cursor: "pointer",
                    }}
                  >
                    {gm.code}
                    <span style={{ display: "block", fontSize: 8.5, fontWeight: 500, color: "#A9AEB8", marginTop: 1 }}>
                      กดดูตู้
                    </span>
                  </th>
                ))}
                <th
                  style={{
                    position: "sticky",
                    top: 0,
                    zIndex: 2,
                    background: "#EEF0F4",
                    padding: "9px 8px",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#5A6270",
                    borderBottom: "1px solid #E3E6EA",
                    minWidth: 74,
                  }}
                >
                  เฉลี่ย/วัน
                </th>
              </tr>
            </thead>
            <tbody>
              {matrix.dayRows.map((r, ri) => (
                <tr key={r.dateLabel} className="co-rowh">
                  <th
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 1,
                      background: ri === 0 ? "#F7F7FE" : "#fff",
                      padding: "7px 12px",
                      textAlign: "left",
                      fontSize: 11.5,
                      fontWeight: ri === 0 ? 700 : 600,
                      color: "#1A1D21",
                      borderBottom: "1px solid #F0F1F4",
                      borderRight: "1px solid #E3E6EA",
                      borderLeft: ri === 0 ? "2px solid #4F46E5" : "2px solid transparent",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.dateLabel} <span style={{ color: "#AEB4BD", fontWeight: 400 }}>{r.wd}</span>
                    {ri === 0 && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", padding: "1px 6px", borderRadius: 20 }}>วันนี้</span>}
                  </th>
                  {r.cells.map((c, ci) => (
                    <td key={ci} style={c.style}>
                      {c.rows.map((cl, li) => (
                        <div key={li} style={cl.style}>
                          {cl.v}
                        </div>
                      ))}
                      {c.swapped && (
                        <span
                          style={{
                            position: "absolute",
                            top: 3,
                            right: 3,
                            width: 5,
                            height: 5,
                            borderRadius: "50%",
                            background: "#4F46E5",
                          }}
                        />
                      )}
                    </td>
                  ))}
                  <td
                    style={{
                      padding: "7px 8px",
                      textAlign: "center",
                      fontWeight: 700,
                      color: "#454B54",
                      background: "#FAFBFC",
                      borderBottom: "1px solid #F0F1F4",
                    }}
                  >
                    {r.avg}
                  </td>
                </tr>
              ))}
              {/* footer: เฉลี่ยตู้ */}
              <tr>
                <th
                  style={{
                    position: "sticky",
                    left: 0,
                    zIndex: 1,
                    background: "#EEF0F4",
                    padding: "9px 12px",
                    textAlign: "left",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "#5A6270",
                    borderTop: "2px solid #DDE0E6",
                    borderRight: "1px solid #E3E6EA",
                  }}
                >
                  เฉลี่ยตู้
                </th>
                {matrix.footer.map((f, fi) => (
                  <td key={fi} style={f.style}>
                    {f.rows.map((fl, li) => (
                      <div key={li} style={fl.style}>
                        {fl.v}
                      </div>
                    ))}
                  </td>
                ))}
                <td style={{ background: "#EEF0F4", borderTop: "2px solid #DDE0E6" }} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* drill modal รายตู้ */}
      <Modal
        open={drill != null}
        onClose={() => setDrillIdx(null)}
        title={drill ? `ตู้ ${drill.code}` : ""}
        sub={drill ? `สาขา${drill.branch} · ดูทุกค่าย้อนหลังรายวัน` : undefined}
        width={580}
        badge={
          drill ? (
            <span
              className="num"
              style={{
                width: 46,
                height: 46,
                flex: "0 0 46px",
                borderRadius: 12,
                background: "#EEF0FE",
                color: "#4F46E5",
                fontWeight: 700,
                fontSize: 12.5,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {drill.code}
            </span>
          ) : undefined
        }
      >
        {drill && (
          <>
            {/* 5 summary tiles */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(5,1fr)",
                gap: 1,
                background: "#EEF0F3",
                borderBottom: "1px solid #EEF0F3",
              }}
            >
              {[
                { label: "ต้นทุน/ตัว", value: drill.avgCost, color: "#1A1D21" },
                { label: "ยอดเก็บ/วัน", value: drill.avgCash, color: "#15803D" },
                { label: "ตุ๊กตาออก/วัน", value: drill.avgDoll, color: "#B45309" },
                { label: "เปลี่ยนตุ๊กตา", value: `${drill.swaps} ครั้ง`, color: "#1A1D21" },
                { label: "เปลี่ยนล่าสุด", value: drill.lastSwap, color: "#1A1D21", small: true },
              ].map((t) => (
                <div key={t.label} style={{ background: "#fff", padding: "11px 6px", textAlign: "center" }}>
                  <div style={{ fontSize: 10, color: "#9AA1AB" }}>{t.label}</div>
                  <div
                    className="num"
                    style={{
                      fontSize: t.small ? 12.5 : 15,
                      fontWeight: 700,
                      marginTop: t.small ? 4 : 2,
                      color: t.color,
                    }}
                  >
                    {t.value}
                  </div>
                </div>
              ))}
            </div>

            {/* daily history table */}
            <table className="num" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>
                  {[
                    { l: "วันที่", a: "left" as const, pad: "9px 20px" },
                    { l: "ต้นทุน/ตัว", a: "right" as const, pad: "9px 12px" },
                    { l: "ยอดเก็บ", a: "right" as const, pad: "9px 12px" },
                    { l: "ตุ๊กตาออก", a: "right" as const, pad: "9px 12px" },
                    { l: "เปลี่ยน", a: "center" as const, pad: "9px 20px 9px 12px" },
                  ].map((h) => (
                    <th
                      key={h.l}
                      style={{
                        textAlign: h.a,
                        padding: h.pad,
                        fontSize: 10.5,
                        color: "#9AA1AB",
                        fontWeight: 600,
                        position: "sticky",
                        top: 0,
                        background: "#fff",
                        borderBottom: "1px solid #EEF0F3",
                      }}
                    >
                      {h.l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {drill.rows.map((dr) => (
                  <tr key={dr.date} style={dr.rowStyle}>
                    <td style={{ padding: "9px 20px", fontWeight: 600 }}>
                      {dr.date} <span style={{ color: "#AEB4BD", fontWeight: 400 }}>{dr.wd}</span>
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "right", fontWeight: 700, color: dr.costColor }}>
                      {dr.cost}
                    </td>
                    <td style={{ padding: "9px 12px", textAlign: "right", color: "#15803D" }}>{dr.cash}</td>
                    <td style={{ padding: "9px 12px", textAlign: "right", color: "#B45309" }}>{dr.dolls}</td>
                    <td style={{ padding: "9px 20px 9px 12px", textAlign: "center" }}>
                      {dr.swapped && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: "#4F46E5",
                            background: "#EEF0FE",
                            padding: "2px 8px",
                            borderRadius: 20,
                          }}
                        >
                          เปลี่ยน
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Modal>
    </div>
  );
}
