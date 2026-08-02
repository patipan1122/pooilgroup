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
import { AlertTriangle, CalendarX, User } from "lucide-react";
import { Modal, EmptyState } from "@/components/clawfleet/os/kit";
import { thDate, thWeekday, bahtN } from "@/components/clawfleet/os/format";
import { assignMachineToStaff } from "@/lib/clawfleet/assignment-actions";
import { ChecklistClient, type ChecklistBranch } from "./checklist-client";
import { RawReadingsClient } from "./raw-readings-client";
import { CellDetailModal } from "./cell-detail-modal";
import { getMatrixCellReadings } from "@/lib/clawfleet/actions";
import type { RawReadingRow } from "@/lib/clawfleet/raw-readings-queries";

export type AssignableStaff = { id: string; name: string };

export type MatrixBranch = { id: string; code: string; name: string; machines: number };

/** ค่ารายวันต่อตู้ (serialized จาก server · cost = null เมื่อไม่มีตุ๊กตาออก) */
export type MatrixSerialDay = {
  cash: number;
  dolls: number;
  cost: number | null;
  swapped: boolean;
  /** เงินวันนี้มี "ยอดตั้งต้น" (ตั้งค่าตู้ครั้งแรก) รวมอยู่ไหม → ติดป้ายแยก */
  baseline: boolean;
  /** วันนี้มี "รอบเก็บเงิน" (COLLECTION) ไหม → นับ "เก็บกี่ตู้" ในคอลัมน์รวม/วัน */
  collected: boolean;
  /** มีรอบ "รอตรวจ" (ANOMALY_REVIEW) ในวันนั้นไหม */
  anomaly: boolean;
  /** CEO 2026-08-02 · เงินขาด/เกินรายตู้ → ช่องแดง (ถ้ายังไม่ตรวจ) · ตรวจ/ยืนยันแล้ว → ฟ้าอ่อน */
  moneyOff?: boolean;
  moneyReviewed?: boolean;
};
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

/* แถบสีตามต้นทุน/ตัว (cost band): เขียว=กำลังดี · เหลือง=ปล่อยง่ายไป(กำไรหด) · แดง=คีบยากไป(ลูกค้าหนี) */
function costBand(v: number): { bg: string; co: string } {
  if (v < 180) return { bg: "#FCF1E2", co: "#B45309" }; // ปล่อยง่ายไป — ต้นทุน/ตัวต่ำ กำไรหด
  if (v > 280) return { bg: "#FCEDEC", co: "#B42318" }; // คีบยากไป — ต้นทุน/ตัวสูง ลูกค้าเลิกเล่น
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
    baseline: false,
    collected: true,
    anomaly: false,
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
// machineId = null เฉพาะ SAMPLE path (DB ว่าง) → มอบหมายไม่ได้
type GridMachine = { machineId: string | null; code: string; nickname: string | null; days: GridDay[] };

type MatrixView = "machine" | "raw" | "branch";

export function MatrixClient({
  branches,
  initialBranch,
  isoDays,
  machines,
  days,
  assignments = {},
  staff = [],
  canManage = false,
  checklistIsoDays = [],
  checklistBranches = [],
  rawRows = [],
  rawTotal = 0,
  rawTruncated = false,
  canEditRaw = false,
}: {
  branches: MatrixBranch[];
  initialBranch: string | null;
  isoDays: string[];
  machines: MatrixSerialMachine[];
  days: 20 | 30;
  // Wave 3 — มอบหมายตู้ให้พนักงาน (map machineId → staffId · เฉพาะตู้ที่ถูก assign)
  assignments?: Record<string, string>;
  staff?: AssignableStaff[];
  canManage?: boolean;
  // Wave 2E1 — เช็คลิสต์ สาขา×วัน (READ-ONLY) จาก getCfChecklistGrid
  checklistIsoDays?: string[];
  checklistBranches?: ChecklistBranch[];
  // ข้อมูลดิบมิเตอร์ (โหมดที่ 3) — เลขที่พนักงานกรอกจริง ของสาขาที่เลือก
  rawRows?: RawReadingRow[];
  rawTotal?: number;
  rawTruncated?: boolean;
  canEditRaw?: boolean;
}) {
  const empty = branches.length === 0;
  const rows = empty ? SAMPLE_BRANCHES : branches;
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // แท็บมุมมอง: ตู้×วัน (เจาะลึกรายสาขา) | สาขา×วัน (เช็คลิสต์ทุกสาขา)
  const [view, setView] = useState<MatrixView>("machine");

  // ชื่อพนักงานจาก staffId (สำหรับป้าย "👤 ชื่อ")
  const staffName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of staff) m.set(s.id, s.name);
    return m;
  }, [staff]);

  // สถานะมอบหมาย (optimistic local) — เริ่มจาก assignments ที่ server ส่งมา
  const [assignMap, setAssignMap] = useState<Record<string, string>>(assignments);
  const [assigning, setAssigning] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);

  const branchCode = useMemo(() => {
    const found = initialBranch && rows.find((b) => b.code === initialBranch);
    return found ? found.code : rows[0]?.code ?? "RS";
  }, [initialBranch, rows]);

  const [metric, setMetric] = useState<Metric>("cost");
  const [drillIdx, setDrillIdx] = useState<number | null>(null);
  // จุด 10 · โค้ดตู้ที่ preselect ในแท็บ "ข้อมูลดิบ" (มาจากปุ่มในป๊อปอัปเจาะตู้) · "all" = ทุกตู้
  const [rawPreselect, setRawPreselect] = useState<string>("all");

  // popup รายช่อง (ตู้ × วัน) — โหลดข้อมูลดิบตอนกด
  const [cell, setCell] = useState<{
    open: boolean;
    loading: boolean;
    rows: RawReadingRow[];
    title: string;
    sub: string;
    key: { machineId: string; iso: string } | null;
  }>({ open: false, loading: false, rows: [], title: "", sub: "", key: null });

  const branch = rows.find((b) => b.code === branchCode) ?? rows[0];
  const machineCount = branch?.machines ?? 8;

  /** เปลี่ยนสาขา/ช่วง → navigate ให้ server ดึงข้อมูลจริงชุดใหม่ */
  const navigate = (nextBranch: string, nextDays: 20 | 30) => {
    const params = new URLSearchParams();
    params.set("branch", nextBranch);
    params.set("days", String(nextDays));
    startTransition(() => router.push(`/clawfleet/os/matrix?${params.toString()}`));
  };

  /** มอบหมายตู้ให้พนักงาน (หรือยกเลิกเมื่อ staffId = null) — optimistic + rollback ถ้า fail */
  const handleAssign = (machineId: string, staffId: string | null) => {
    if (assigning) return;
    const prev = assignMap[machineId] ?? null;
    if (prev === staffId) return; // ไม่เปลี่ยน = ไม่ทำอะไร
    setAssignError(null);
    setAssigning(true);
    // optimistic
    setAssignMap((m) => {
      const next = { ...m };
      if (staffId) next[machineId] = staffId;
      else delete next[machineId];
      return next;
    });
    void assignMachineToStaff(machineId, staffId)
      .then((res) => {
        if (!res.ok) {
          // rollback
          setAssignMap((m) => {
            const next = { ...m };
            if (prev) next[machineId] = prev;
            else delete next[machineId];
            return next;
          });
          setAssignError(res.error);
        } else {
          router.refresh();
        }
      })
      .catch((e: unknown) => {
        setAssignMap((m) => {
          const next = { ...m };
          if (prev) next[machineId] = prev;
          else delete next[machineId];
          return next;
        });
        setAssignError(e instanceof Error ? e.message : "มอบหมายไม่สำเร็จ");
      })
      .finally(() => setAssigning(false));
  };

  /* แถววัน (ใหม่→เก่า) + grid ค่าจริง (หรือ sample เมื่อ DB ว่าง) */
  const grid = useMemo(() => {
    // SAMPLE path — DB ว่าง: สร้าง deterministic จาก code (โชว์โครงหน้า)
    if (empty) {
      const seed0 = (branchCode.charCodeAt(0) || 65) + (branchCode.charCodeAt(1) || 65);
      const sIso = sampleIsoDays(days);
      const sMachines = sampleMachines(branchCode, machineCount);
      const gm: GridMachine[] = sMachines.map((m, mi) => ({
        machineId: null,
        code: m.code,
        nickname: null,
        days: sIso.map((_iso, di) => ({ ...sampleVals(seed0, m, mi, di), baseline: false, anomaly: false, hasData: true })),
      }));
      return { iso: sIso, machines: gm };
    }
    // REAL path — เรียงวันตาม isoDays (ใหม่→เก่า) · เติมช่องว่าง = ไม่มีข้อมูล
    const gm: GridMachine[] = machines.map((m) => ({
      machineId: m.machineId,
      code: m.code,
      nickname: m.nickname,
      days: isoDays.map((iso) => {
        const d = m.days[iso];
        if (!d) return { cash: 0, dolls: 0, cost: null, swapped: false, baseline: false, collected: false, anomaly: false, hasData: false };
        return { ...d, hasData: true };
      }),
    }));
    return { iso: isoDays, machines: gm };
  }, [empty, branchCode, machineCount, days, isoDays, machines]);

  /* สร้างเมทริกซ์ที่ render ได้ (รายแถว=วัน · คอลัมน์=ตู้) + footer เฉลี่ยตู้ */
  const matrix = useMemo(() => {
    const cols = grid.machines.length;
    const colCost = new Array<number>(cols).fill(0);
    const colCostCnt = new Array<number>(cols).fill(0); // นับเฉพาะวันที่มีต้นทุน/ตัวจริง (วันตั้งต้นไม่นับ)
    const colCash = new Array<number>(cols).fill(0);
    const colDoll = new Array<number>(cols).fill(0);
    const colCnt = new Array<number>(cols).fill(0);

    type Cell = { rows: { v: string; style: React.CSSProperties }[]; swapped: boolean; baseline: boolean; anomaly: boolean; hasData: boolean; style: React.CSSProperties };
    // dayRows: cashTotal = ยอดรวมเงินวันนั้น (รวมตั้งต้น · ตรงกับช่องในตาราง) · collected = จำนวนตู้ที่ "เก็บเงิน" วันนั้น
    const dayRows: { dateLabel: string; wd: string; cells: Cell[]; avg: string; cashTotal: number; collected: number }[] = [];
    let grandCash = 0; // ยอดรวมทั้งช่วง (มุมขวาล่าง)
    let grandColl = 0; // จำนวนครั้งที่เก็บทั้งช่วง

    grid.iso.forEach((iso, di) => {
      const dt = isoToDate(iso);
      let daySum = 0;
      let dayCnt = 0;
      let dayCash = 0; // เงินรวมวันนั้น (ทุกตู้ · รวมตั้งต้น)
      let dayColl = 0; // จำนวนตู้ที่มีรอบเก็บ (COLLECTION) วันนั้น
      const cells: Cell[] = grid.machines.map((gm, mi) => {
        const rv = gm.days[di];
        if (!rv || !rv.hasData) {
          return {
            rows: [{ v: "—", style: { color: "#B6BBC4" } }],
            swapped: false,
            baseline: false,
            anomaly: false,
            hasData: false,
            style: { ...CELL_PAD, background: "#F4F5F7", color: "#B6BBC4" },
          };
        }
        dayCash += rv.cash;
        if (rv.collected) dayColl += 1;
        // cost = null (ไม่มีตุ๊กตาออก · เช่น วันตั้งต้น) → โชว์ "—" + พื้น neutral (ไม่ใช่ส้ม "ปล่อยง่าย")
        // และไม่นับเข้าค่าเฉลี่ยต้นทุน/ตัว กันวันตั้งต้นดึงคอลัมน์ให้ดูแดง
        const hasCostVal = rv.cost != null;
        const costVal = rv.cost ?? 0;
        if (hasCostVal) { colCost[mi] += costVal; colCostCnt[mi] += 1; }
        colCash[mi] += rv.cash;
        colDoll[mi] += rv.dolls;
        colCnt[mi] += 1;
        const cb = hasCostVal ? costBand(costVal) : { bg: "#F3F4F6", co: "#9AA0AA" };
        let bg: string;
        let cellRows: { v: string; style: React.CSSProperties }[];
        let primary: number;
        if (metric === "cash") {
          bg = cashHeat(rv.cash);
          primary = rv.cash;
          cellRows = [{ v: bahtN(rv.cash), style: { fontWeight: 600, color: "#1A1D21" } }];
        } else if (metric === "dolls") {
          bg = dollHeat(rv.dolls);
          primary = rv.dolls;
          cellRows = [{ v: String(rv.dolls), style: { fontWeight: 600, color: "#1A1D21" } }];
        } else if (metric === "all") {
          bg = cb.bg;
          primary = costVal;
          cellRows = [
            { v: rv.cost == null ? "—" : bahtN(rv.cost), style: { fontWeight: 700, color: cb.co, fontSize: 11.5 } },
            { v: bahtN(rv.cash), style: { fontWeight: 500, color: "#15803D", fontSize: 10.5 } },
            { v: `${rv.dolls} ตัว`, style: { fontWeight: 500, color: "#B45309", fontSize: 10.5 } },
          ];
        } else {
          bg = cb.bg;
          primary = costVal;
          cellRows = [{ v: rv.cost == null ? "—" : bahtN(rv.cost), style: { fontWeight: rv.swapped ? 700 : 600, color: cb.co } }];
        }
        // CEO 2026-08-02 · เงินขาด/เกิน = ช่องแดง · พอ admin ตรวจ/ยืนยัน = ฟ้าอ่อน (ไม่ปล่อยแดงค้าง) — เด่นกว่า heatmap
        if (rv.moneyReviewed) bg = "#E5F2FD";        // ฟ้าอ่อน = ตรวจแล้ว
        else if (rv.moneyOff) bg = "#FCE4E4";        // แดงอ่อน = เงินไม่ตรง ยังไม่ตรวจ
        daySum += primary;
        dayCnt += 1;
        return {
          rows: cellRows,
          swapped: rv.swapped,
          baseline: rv.baseline,
          anomaly: rv.anomaly,
          hasData: true,
          style: {
            ...CELL_PAD,
            background: bg,
            // เงินขาด/เกินเด่นสุด → แดง(ยังไม่ตรวจ)/ฟ้า(ตรวจแล้ว) · ไม่งั้น รอตรวจ→ส้ม · refill→คราม
            ...(rv.moneyOff && !rv.moneyReviewed
              ? { boxShadow: "inset 0 0 0 2px #E5484D" }
              : rv.moneyReviewed
                ? { boxShadow: "inset 0 0 0 2px #3B9EED" }
                : rv.anomaly
                  ? { boxShadow: "inset 0 0 0 2px #F97316" }
                  : rv.swapped
                    ? { boxShadow: "inset 0 0 0 2px #4F46E5" }
                    : {}),
          },
        };
      });
      const avgv = dayCnt ? Math.round(daySum / dayCnt) : 0;
      grandCash += dayCash;
      grandColl += dayColl;
      dayRows.push({
        dateLabel: thDate(dt),
        wd: thWeekday(dt),
        cells,
        avg: metric === "dolls" ? String(avgv) : bahtN(avgv),
        cashTotal: dayCash,
        collected: dayColl,
      });
    });

    const footer = grid.machines.map((_gm, mi) => {
      const cnt = colCnt[mi] || 1;
      const aCost = colCostCnt[mi] > 0 ? Math.round(colCost[mi] / colCostCnt[mi]) : 0; // เฉลี่ยเฉพาะวันที่มีต้นทุนจริง
      const aCash = Math.round(colCash[mi] / cnt);
      const aDoll = Math.round(colDoll[mi] / cnt);
      const cb = costBand(aCost);
      let bg = "#fff";
      let frows: { v: string; style: React.CSSProperties }[];
      if (metric === "cash") {
        frows = [{ v: bahtN(aCash), style: { fontWeight: 700, color: "#454B54" } }];
      } else if (metric === "dolls") {
        frows = [{ v: String(aDoll), style: { fontWeight: 700, color: "#454B54" } }];
      } else if (metric === "all") {
        bg = cb.bg;
        frows = [
          { v: bahtN(aCost), style: { fontWeight: 700, color: cb.co, fontSize: 11 } },
          { v: bahtN(aCash), style: { color: "#15803D", fontSize: 10 } },
          { v: `${aDoll} ตัว`, style: { color: "#B45309", fontSize: 10 } },
        ];
      } else {
        bg = cb.bg;
        frows = [{ v: bahtN(aCost), style: { fontWeight: 700, color: cb.co } }];
      }
      return { rows: frows, style: { ...CELL_PAD, background: bg, borderTop: "2px solid #DDE0E6" } };
    });

    return { dayRows, footer, grandCash, grandColl };
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
        cost: rv.cost == null ? "—" : bahtN(rv.cost),
        costColor: cb.co,
        cash: bahtN(rv.cash),
        dolls: String(rv.dolls),
        swapped: rv.swapped,
        rowStyle: { borderBottom: "1px solid #F0F1F4", ...(rv.swapped ? { background: "#EEF0FE" } : {}) },
      });
    });
    const denomAll = cntAll || 1;
    return {
      machineId: gm.machineId,
      code: gm.code,
      branch: branch?.name ?? "",
      avgCost: cntCost > 0 ? bahtN(Math.round(sc / cntCost)) : "—",
      avgCash: bahtN(Math.round(sh / denomAll)),
      avgDoll: String(Math.round(sd / denomAll)),
      swaps: String(swaps),
      lastSwap: lastSwap == null ? "ไม่พบ" : lastSwap === 0 ? "วันนี้" : `${lastSwap} วันก่อน`,
      rows: drows,
    };
  }, [drillIdx, grid, branch]);

  /** โหลดข้อมูลดิบของช่อง (ตู้ × วัน) จาก server — ใช้ทั้งตอนกดครั้งแรกและหลังแก้ (refresh) */
  const loadCell = (machineId: string, iso: string) => {
    setCell((c) => ({ ...c, loading: true }));
    void getMatrixCellReadings({ branchCode, machineId, isoDay: iso })
      .then((res) => {
        setCell((c) =>
          c.key && c.key.machineId === machineId && c.key.iso === iso
            ? { ...c, loading: false, rows: res.ok ? res.data.rows : [] }
            : c,
        );
      })
      .catch(() => setCell((c) => ({ ...c, loading: false, rows: [] })));
  };

  /** กดช่องในเมทริกซ์ → เปิด popup + โหลดข้อมูล (เฉพาะช่องที่มีข้อมูล + ข้อมูลจริง ไม่ใช่ตัวอย่าง) */
  const openCell = (ci: number, ri: number) => {
    if (empty) return; // sample path — ไม่มี event จริง
    const gm = grid.machines[ci];
    if (!gm?.machineId) return;
    const iso = grid.iso[ri];
    const dayLabel = matrix.dayRows[ri]?.dateLabel ?? iso;
    setCell({
      open: true,
      loading: true,
      rows: [],
      title: `ตู้ ${gm.code}${gm.nickname ? ` · ${gm.nickname}` : ""}`,
      sub: `${dayLabel} · ${branch?.name ?? ""}`,
      key: { machineId: gm.machineId, iso },
    });
    loadCell(gm.machineId, iso);
  };

  const noData = !empty && grid.machines.length === 0;
  // สาขา "ตั้งตู้แล้ว (มีตู้จริง) แต่ทุกช่องไม่มีข้อมูลในช่วงนี้" = ยังไม่มีทั้งยอดตั้งต้นและรอบเก็บ
  // (baseline/ตั้งต้น = INITIAL · รอบเก็บ = COLLECTION → ตอนนี้นับทั้งคู่เป็นรายได้ · D-025)
  // แยกจากตารางว่างเปล่าด้วยแบนเนอร์อธิบาย ไม่ให้ดูเหมือนระบบพัง.
  const machinesNoCollections =
    !empty &&
    grid.machines.length > 0 &&
    grid.machines.every((m) => m.days.every((d) => !d.hasData));

  return (
    <div style={{ opacity: pending ? 0.6 : 1, transition: "opacity .15s" }}>
      {/* มุมมอง: ตู้×วัน (เจาะลึกรายสาขา) | สาขา×วัน (เช็คลิสต์เก็บเงินทุกสาขา) */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16, background: "#fff", border: "1px solid #E3E6EA", borderRadius: 11, padding: 4, width: "fit-content" }}>
        {([
          { key: "machine", label: "ตู้ × วัน", sub: "เจาะลึกรายสาขา" },
          { key: "raw", label: "ข้อมูลดิบ", sub: "เลขที่พนักงานกรอก" },
          { key: "branch", label: "สาขา × วัน", sub: "เช็คลิสต์เก็บเงิน" },
        ] as const).map((t) => {
          const on = t.key === view;
          return (
            <button
              key={t.key}
              // กดแท็บ "ข้อมูลดิบ" ตรง ๆ = ดูทุกตู้ (รีเซ็ต preselect · การเจาะตู้เดียวมาจากปุ่มในป๊อปอัป)
              onClick={() => { setView(t.key); if (t.key === "raw") setRawPreselect("all"); }}
              style={{
                border: "none",
                cursor: "pointer",
                textAlign: "left",
                padding: "7px 15px",
                borderRadius: 8,
                background: on ? "#4F46E5" : "transparent",
                color: on ? "#fff" : "#5A6270",
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 700 }}>{t.label}</div>
              <div style={{ fontSize: 10, fontWeight: 500, color: on ? "rgba(255,255,255,0.8)" : "#9AA1AB", marginTop: 1 }}>{t.sub}</div>
            </button>
          );
        })}
      </div>

      {view === "branch" ? (
        <ChecklistClient isoDays={checklistIsoDays} branches={checklistBranches} />
      ) : (
      <>
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
        {view === "raw"
          ? "เลือกสาขาเพื่อดูข้อมูลดิบที่พนักงานกรอก — ทุกตู้ ทุกรายการ ในหน้าเดียว"
          : "เลือกสาขาเพื่อดูตารางเจาะลึก — ทุกตู้ × รายวันย้อนหลังในหน้าเดียว"}
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

      {view === "raw" ? (
        <RawReadingsClient
          key={rawPreselect}
          rows={rawRows}
          canEdit={canEditRaw}
          branchName={branch?.name ?? branchCode}
          total={rawTotal}
          truncated={rawTruncated}
          preselectMachine={rawPreselect}
        />
      ) : (
      <>
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

      {/* สาขามีตู้แล้วแต่ยังไม่มีรอบเก็บเงินจริง — อธิบายให้ชัด ไม่ให้ตาราง "—" เต็มจอดูเหมือนพัง */}
      {machinesNoCollections && (
        <div
          style={{
            display: "flex",
            gap: 9,
            alignItems: "flex-start",
            background: "#EEF2FF",
            border: "1px solid #C7D2FE",
            borderRadius: 10,
            padding: "11px 15px",
            marginBottom: 14,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "#3730A3",
          }}
        >
          <AlertTriangle size={16} style={{ flex: "0 0 16px", marginTop: 1 }} />
          <span>
            <b>สาขานี้ตั้งตู้แล้ว ({machineCount} ตู้) แต่ยังไม่มีความเคลื่อนไหวในช่วง {days} วันนี้</b> — ตัวเลขในตารางจะขึ้น
            ทันทีที่พนักงานบันทึกการตั้งค่าตู้ (ยอดตั้งต้น) หรือเก็บเงินรอบจริง
            <span style={{ display: "block", color: "#6366F1", fontSize: 11.5, marginTop: 3 }}>
              ทั้ง “ยอดตั้งต้น” (เงินที่นับได้ตอนตั้งค่าตู้ครั้งแรก) และรอบเก็บเงินปกติ — นับเป็นรายได้เหมือนกัน ให้ตรงกับหน้าฝากเงินและ P&L
            </span>
          </span>
        </div>
      )}

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
          ปล่อยง่ายไป (กำไรหด) <span className="num" style={{ color: "#A9AEB8" }}>&lt;฿180</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 13, height: 13, borderRadius: 4, background: "#E7F4EC", display: "inline-block" }} />
          กำลังดี <span className="num" style={{ color: "#A9AEB8" }}>฿180–280</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 13, height: 13, borderRadius: 4, background: "#FCEDEC", display: "inline-block" }} />
          คีบยากไป (ลูกค้าหนี) <span className="num" style={{ color: "#A9AEB8" }}>&gt;฿280</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#B45309" }}>ตต</span>
          = มียอดตั้งต้น
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#F97316", display: "inline-block" }} />
          รอตรวจ
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
      <div style={{ position: "relative", background: "#fff", border: "1px solid #E8EAED", borderRadius: 14, overflow: "hidden" }}>
        {empty && (
          <span style={{ position: "absolute", top: 10, right: 16, zIndex: 4, fontSize: 11, fontWeight: 700, letterSpacing: 2, color: "#C2C7CF", pointerEvents: "none" }}>ตัวอย่าง · DEMO</span>
        )}
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
                {grid.machines.map((gm, i) => {
                  const asgId = gm.machineId ? assignMap[gm.machineId] : undefined;
                  const asgName = asgId ? staffName.get(asgId) : undefined;
                  return (
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
                      {gm.nickname ? (
                        <span style={{ display: "block", fontSize: 9.5, fontWeight: 500, color: "#8A90A0", lineHeight: 1.1 }}>
                          {gm.nickname}
                        </span>
                      ) : null}
                      {asgName ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 2,
                            maxWidth: 78,
                            marginTop: 2,
                            padding: "1px 6px",
                            borderRadius: 20,
                            background: "#EEF0FE",
                            color: "#4F46E5",
                            fontSize: 8.5,
                            fontWeight: 700,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={`มอบหมายให้ ${asgName}`}
                        >
                          <User size={8} /> {asgName}
                        </span>
                      ) : (
                        <span style={{ display: "block", fontSize: 8.5, fontWeight: 500, color: "#A9AEB8", marginTop: 1 }}>
                          กดดูตู้
                        </span>
                      )}
                    </th>
                  );
                })}
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
                    borderLeft: "1px solid #E3E6EA",
                    minWidth: 86,
                  }}
                >
                  รวมวันนั้น
                  <span style={{ display: "block", fontSize: 8.5, fontWeight: 500, color: "#9AA1AB", marginTop: 1 }}>ยอด · เก็บกี่ตู้</span>
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
                  {r.cells.map((c, ci) => {
                    const clickable = !empty && c.hasData && !!grid.machines[ci]?.machineId;
                    return (
                    <td
                      key={ci}
                      style={clickable ? { ...c.style, cursor: "pointer" } : c.style}
                      onClick={clickable ? () => openCell(ci, ri) : undefined}
                      title={clickable ? "กดดูข้อมูลที่กรอก + รูป + แก้ไข" : undefined}
                    >
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
                      {c.baseline && (
                        <span
                          title="มียอดตั้งต้น (ตั้งค่าตู้ครั้งแรก)"
                          style={{ position: "absolute", bottom: 2, left: 3, fontSize: 8, fontWeight: 700, color: "#B45309", lineHeight: 1 }}
                        >
                          ตต
                        </span>
                      )}
                      {c.anomaly && (
                        <span
                          title="มีรอบรอตรวจ (ยอดน่าสงสัย)"
                          style={{ position: "absolute", top: 3, left: 3, width: 5, height: 5, borderRadius: "50%", background: "#F97316" }}
                        />
                      )}
                    </td>
                    );
                  })}
                  <td
                    style={{
                      padding: "6px 8px",
                      textAlign: "center",
                      background: "#FAFBFC",
                      borderBottom: "1px solid #F0F1F4",
                      borderLeft: "1px solid #E3E6EA",
                    }}
                  >
                    <div style={{ fontWeight: 700, color: r.cashTotal > 0 ? "#15803D" : "#9AA1AB", fontSize: 12.5, lineHeight: 1.2 }}>
                      {bahtN(r.cashTotal)}
                    </div>
                    <div style={{ fontSize: 9.5, color: "#8A90A0", fontWeight: 600, marginTop: 1 }}>
                      {r.collected > 0 ? `เก็บ ${r.collected} ตู้` : "—"}
                    </div>
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
                <td style={{ background: "#EEF0F4", borderTop: "2px solid #DDE0E6", borderLeft: "1px solid #E3E6EA", textAlign: "center", padding: "6px 8px" }}>
                  <div style={{ fontWeight: 800, color: "#15803D", fontSize: 12, lineHeight: 1.2 }}>{bahtN(matrix.grandCash)}</div>
                  <div style={{ fontSize: 8.5, color: "#5A6270", fontWeight: 600, marginTop: 1 }}>เก็บรวม {matrix.grandColl} ครั้ง</div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* popup รายช่อง (ตู้ × วัน) — ข้อมูลที่พนักงานกรอก + รูป + แก้ไข */}
      <CellDetailModal
        open={cell.open}
        onClose={() => setCell((c) => ({ ...c, open: false }))}
        title={cell.title}
        sub={cell.sub}
        loading={cell.loading}
        rows={cell.rows}
        canEdit={canEditRaw}
        onSaved={() => {
          if (cell.key) loadCell(cell.key.machineId, cell.key.iso);
          router.refresh();
        }}
      />

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
            {/* จุด 10 · กดดูข้อมูลดิบ (มิเตอร์ดิจิตอล/เฟือง ก่อน→หลัง) ย้อนหลังเฉพาะตู้นี้ */}
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #EEF0F3" }}>
              <button
                type="button"
                onClick={() => { setRawPreselect(drill.code); setView("raw"); setDrillIdx(null); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "#4F46E5", background: "#EEF0FE", border: "none", borderRadius: 9, padding: "8px 14px", cursor: "pointer" }}
              >
                ดูข้อมูลดิบย้อนหลังตู้นี้ (เลขมิเตอร์ทุกรอบ) →
              </button>
            </div>
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

            {/* มอบหมายตู้ให้พนักงาน — เฉพาะ ผจก./แอดมิน + ตู้จริง (ไม่ใช่ตัวอย่าง) */}
            {canManage && drill.machineId && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flexWrap: "wrap",
                  padding: "12px 20px",
                  borderBottom: "1px solid #EEF0F3",
                  background: "#FAFBFF",
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "#5A6270" }}>
                  <User size={14} /> มอบหมายให้
                </span>
                <select
                  value={assignMap[drill.machineId] ?? ""}
                  disabled={assigning || pending}
                  onChange={(e) => {
                    if (drill.machineId) handleAssign(drill.machineId, e.target.value || null);
                  }}
                  style={{
                    flex: 1,
                    minWidth: 160,
                    fontSize: 12.5,
                    padding: "7px 10px",
                    borderRadius: 8,
                    border: "1px solid #D8DBE1",
                    background: "#fff",
                    color: "#1A1D21",
                    cursor: assigning || pending ? "not-allowed" : "pointer",
                  }}
                >
                  <option value="">— ไม่มอบหมาย (ใครก็เก็บได้)</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {assigning && <span style={{ fontSize: 11, color: "#9AA1AB" }}>กำลังบันทึก…</span>}
                {assignError && <span style={{ fontSize: 11, color: "#B42318", width: "100%" }}>{assignError}</span>}
                {staff.length === 0 && !assigning && (
                  <span style={{ fontSize: 11, color: "#9AA1AB", width: "100%" }}>
                    ยังไม่มีพนักงานผูกกับสาขานี้ — เพิ่มพนักงานเข้าสาขาก่อนถึงจะมอบหมายได้
                  </span>
                )}
              </div>
            )}

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
      </>
      )}
      </>
      )}
    </div>
  );
}
