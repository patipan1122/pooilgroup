// ClawFleet v2 — real-DB query layer.
// Returns the SAME shapes as lib/clawfleet/data.ts (the mockup types) but
// sourced from real cf_* tables. Pages call these in server components and pass
// the result to the client islands, so the rendering code is unchanged.
//
// Requires migration 20260528000001_clawfleet_v2_branch_model applied.

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { requireSession, type Session } from "@/lib/auth/session";
import { userBranchIds } from "./role-guard";
import { deriveEvent, cleanNote } from "./validation";
import type {
  Branch,
  BranchTone,
  Anomaly,
  Machine,
  ActiveSession,
  ClosedSession,
  SessionDetail,
  SessionDetailStatus,
  StockEntry,
  Delivery,
  TodaySummary,
  TrendDay,
  BranchPerf,
  InsightRow,
} from "./data";

const TONES: BranchTone[] = [
  "indigo", "cyan", "emerald", "amber", "violet", "rose", "sky", "lime", "fuchsia", "teal",
];
/** deterministic tone from a branch id */
function toneFor(id: string): BranchTone {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TONES[h % TONES.length]!;
}
function firstChar(s: string): string {
  return s.trim().charAt(0) || "?";
}
function thaiTime(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok", hour12: false,
  }).format(d);
}
function thaiDateShort(d: Date): string {
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric", month: "short", timeZone: "Asia/Bangkok",
  }).format(d);
}
function timeAgo(d: Date): string {
  const ms = Date.now() - d.getTime();
  const hr = Math.floor(ms / 3_600_000);
  if (hr < 1) return "ไม่ถึงชม.";
  if (hr < 24) return `${hr} ชม.`;
  return `${Math.floor(hr / 24)} วัน`;
}

/**
 * จัดระดับความรุนแรง (severity band) จากส่วนต่างเงิน % + ตุ๊กตาหาย.
 * ใช้ร่วมกันทั้ง anomaly inbox และหน้ากระทบยอด (ให้ label ตรงกันทุกที่).
 *   P0 = ห่างมาก (เงิน >25% หรือ ตุ๊กตาต่าง >4) · P1 = ห่างพอควร · P2 = ห่างเล็กน้อย/ในเกณฑ์
 * gapPct = |ส่วนต่าง| เป็น % (ไม่คิดทิศทาง — ทั้งขาดและเกินถือว่าผิดปกติ)
 */
function severityOf(gapPct: number, prizeGap: number): "P0" | "P1" | "P2" {
  const p = Math.abs(prizeGap);
  if (gapPct > 25 || p > 4) return "P0";
  if (gapPct > 8 || p > 0) return "P1";
  return "P2";
}

async function scope(session: Session): Promise<{ orgId: string; branchIds: string[] | "ALL" }> {
  const bs = await userBranchIds(session);
  return { orgId: session.user.org_id, branchIds: bs };
}
/** narrow a branchId list by an optional explicit filter from the UI */
function effectiveBranchWhere(
  branchIds: string[] | "ALL",
  filter?: string,
): { in: string[] } | undefined {
  if (filter && filter !== "all") {
    if (branchIds === "ALL" || branchIds.includes(filter)) return { in: [filter] };
    return { in: [] }; // out of scope → empty
  }
  return branchIds === "ALL" ? undefined : { in: branchIds };
}

// =============================================================
// Branches (claw_machine business type)
// =============================================================
export const getV2Branches = cache(async (): Promise<Branch[]> => {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);
  const rows = await prisma.branch.findMany({
    where: {
      orgId,
      businessType: "claw_machine",
      isActive: true,
      ...(branchIds === "ALL" ? {} : { id: { in: branchIds } }),
    },
    include: {
      manager: { select: { name: true } },
      _count: { select: { cfMachines: { where: { isActive: true } } } },
    },
    orderBy: { code: "asc" },
  });
  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
    area: b.province ?? b.region ?? "—",
    machines: b._count.cfMachines,
    manager: b.manager?.name ?? "—",
    avatar: firstChar(b.manager?.name ?? b.name),
    tone: toneFor(b.id),
  }));
});

/**
 * นับ "รอบที่ยังค้าง" ต่อสาขา (CEO 2026-08-02) — สำหรับเลขแดงบนแถบเลือกสาขา ในรายงานเจาะสาขา.
 * ค้าง = รอบที่ยัง "ไม่ปิด" (OPEN · กำลังเก็บ / รอบว่างที่ยังไม่เคลียร์) + ปิดแล้วแต่ "รอตรวจ" (ANOMALY_REVIEW).
 * คืน map branchId → จำนวนรอบค้าง (เฉพาะรอบระดับสาขา · scope ตามสิทธิ์ user). อ่านอย่างเดียว ไม่แตะเงิน.
 */
export const getPendingRoundCountsByBranch = cache(
  async (): Promise<Record<string, number>> => {
    const session = await requireSession();
    const { orgId, branchIds } = await scope(session);
    const grouped = await prisma.cfCollectionSession.groupBy({
      by: ["branchId"],
      where: {
        orgId,
        status: { in: ["OPEN", "ANOMALY_REVIEW"] },
        branchId: branchIds === "ALL" ? { not: null } : { in: branchIds },
      },
      _count: { _all: true },
    });
    const out: Record<string, number> = {};
    for (const g of grouped) {
      if (g.branchId) out[g.branchId] = g._count._all;
    }
    return out;
  },
);

// =============================================================
// Manage page — branches WITH their machine list (for CRUD UI)
// =============================================================
export type ManageMachine = {
  id: string;
  code: string;
  nickname: string | null;
  kind: "CLAW" | "EXCHANGER";
  isActive: boolean;
};
export type ManageBranch = {
  id: string;
  name: string;
  code: string;
  area: string;
  manager: string;
  avatar: string;
  tone: BranchTone;
  machineCount: number;
  machines: ManageMachine[];
};

/** สาขาตู้คีบ + รายการตู้ในแต่ละสาขา (active เท่านั้น) สำหรับหน้า "จัดการ". */
export async function getV2ManageBranches(): Promise<ManageBranch[]> {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);
  const rows = await prisma.branch.findMany({
    where: {
      orgId,
      businessType: "claw_machine",
      isActive: true,
      ...(branchIds === "ALL" ? {} : { id: { in: branchIds } }),
    },
    include: {
      manager: { select: { name: true } },
      cfMachines: {
        where: { isActive: true },
        select: { id: true, code: true, nickname: true, kind: true, isActive: true },
        orderBy: { code: "asc" },
      },
    },
    orderBy: { code: "asc" },
  });
  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    code: b.code,
    area: b.province ?? b.region ?? "—",
    manager: b.manager?.name ?? "—",
    avatar: firstChar(b.manager?.name ?? b.name),
    tone: toneFor(b.id),
    machineCount: b.cfMachines.length,
    machines: b.cfMachines.map((m) => ({
      id: m.id,
      code: m.code,
      nickname: m.nickname,
      kind: m.kind as "CLAW" | "EXCHANGER",
      isActive: m.isActive,
    })),
  }));
}

// =============================================================
// Anomalies (sessions in ANOMALY_REVIEW) — with machines
// =============================================================
export async function listV2Anomalies(filter?: string): Promise<Anomaly[]> {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);
  const branchWhere = effectiveBranchWhere(branchIds, filter);

  const rows = await prisma.cfCollectionSession.findMany({
    where: {
      orgId,
      status: "ANOMALY_REVIEW",
      ...(branchWhere ? { branchId: branchWhere } : {}),
    },
    include: {
      branch: { select: { name: true, code: true } },
      openedBy: { select: { name: true } },
      events: {
        where: { eventType: "COLLECTION" },
        include: { machine: { select: { code: true, nickname: true, kind: true } } },
      },
    },
    orderBy: { closedAt: "desc" },
    take: 50,
  });

  return rows.map((s): Anomaly => {
    const expectedCash = Math.round((s.expectedCashCents ?? 0) / 100);
    const actualCash = Math.round((s.actualCashCents ?? 0) / 100);
    // ⚠️ gap เก็บทิศทาง: บวก = เงินขาด (นับได้น้อยกว่ามิเตอร์) · ลบ = เงินเกิน
    // เดิม Math.max(0, ...) ปัดเงินเกินทิ้ง → ตรวจโกงพลาด (เงินเกินก็ผิดปกติ)
    const gap = expectedCash - actualCash;
    const gapPct = expectedCash > 0 ? (Math.abs(gap) / expectedCash) * 100 : 0;
    const prizeGap = s.prizeVariance ?? 0;
    const opened = s.openedAt;
    const closed = s.closedAt ?? s.openedAt;
    const durMin = Math.max(1, Math.round((closed.getTime() - opened.getTime()) / 60000));
    const isCash = gap > 0;
    const machines: Machine[] = s.events
      .filter((e) => e.machine.kind === "CLAW")
      .map((e) => eventToMachine(e));
    const branchName = s.branch?.name ?? "";
    const branchCode = s.branch?.code ?? "";
    // ชื่อตู้ที่จะโชว์ในบรรทัดรอง — ตู้คีบตัวแรกของรอบ (nickname ?? code)
    const firstMachine = machines[0];
    const machineName = firstMachine?.name ?? "";
    return {
      id: s.sessionCode,
      branchId: s.branchId ?? "",
      branchName,
      branchCode,
      machineName,
      severity: severityOf(gapPct, prizeGap),
      type: isCash ? "cash_short" : "prize_short",
      typeLabel: isCash ? "เงินขาด" : "ตุ๊กตาหาย",
      reason: s.anomalyFlags[0] ?? (isCash ? "เงินที่เก็บได้น้อยกว่าเลขมิเตอร์" : "ตุ๊กตาที่นับน้อยกว่าที่ระบบคำนวณ"),
      expectedCash,
      actualCash,
      gap,
      gapPct,
      prizeExpected: s.prizeMeterOut ?? 0,
      prizeActual: s.prizeCountedOut ?? 0,
      prizeGap,
      sessionStart: thaiTime(opened),
      sessionEnd: thaiTime(closed),
      duration: `${durMin} นาที`,
      timeAgo: timeAgo(closed),
      timestamp: `${thaiTime(closed)} · ${thaiDateShort(closed)}`,
      staff: s.openedBy.name,
      staffAvatar: firstChar(s.openedBy.name),
      machines,
    };
  });
}

// =============================================================
// All collection rounds (หน้ากระทบยอด — "รอบเก็บทั้งหมด" ไม่ใช่แค่ผิดปกติ)
// ดึงทุกรอบที่ปิดแล้ว (CLOSED / ANOMALY_REVIEW / LOCKED / CANCELLED) ในช่วงเวลา
// เพื่อให้การ์ดสรุป + แท็บ (ทั้งหมด/ตรงกัน/ไม่ตรง/ตู้เสีย) คำนวณจากชุดเต็มจริง.
// =============================================================

/** สถานะรอบที่ "ปิดแล้ว" (กระทบยอดเสร็จ) */
const CLOSED_STATUSES = ["CLOSED", "ANOMALY_REVIEW", "LOCKED", "CANCELLED"] as const;
/** สถานะที่ "แสดงในหน้ากระทบยอด" — ปิดแล้ว + กำลังเก็บ (OPEN · ยังเก็บไม่จบ).
 *  CEO 2026-08-01: เก็บตู้ไหนต้องเห็นตู้นั้นทันที ไม่ต้องรอปิดรอบครบทุกตู้. */
const VISIBLE_STATUSES = [...CLOSED_STATUSES, "OPEN"] as const;

// เกณฑ์เงินขาด/เกินที่ "ถือว่าตรง" (บาท) — ต้องตรงกับ CASH_TOLERANCE ฝั่ง collections-client
// (statusOf: |gap| <= นี้ = ตรงกัน) เพื่อ severity/type ไม่ขัดกับที่หน้าจอแสดง.
const CASH_TOLERANCE_BAHT = 50;

/** หนึ่งรอบเก็บสำหรับหน้ากระทบยอด (display shape · บาท + มิเตอร์จริง) */
export type V2Round = {
  id: string; // sessionCode
  branchId: string;
  branchName: string;
  branchCode: string;
  staff: string;
  /** เวลาปิดรอบแบบอ่านง่าย (HH:mm · d MMM) */
  when: string;
  /** "x ชม.ที่แล้ว" / "x วัน" */
  timeAgo: string;
  status: string; // CfSessionStatus ดิบ (ไว้ทำ CSV / debug)
  expectedCash: number; // บาท — มิเตอร์ควรได้
  actualCash: number; // บาท — เงินนับได้
  /** ส่วนต่าง (บาท) เก็บทิศทาง: บวก = ขาด · ลบ = เกิน */
  gap: number;
  prizeExpected: number;
  prizeActual: number;
  prizeGap: number; // ตุ๊กตาหาย (บวก = หาย)
  severity: "P0" | "P1" | "P2";
  type: "cash_short" | "prize_short";
  reason: string;
  /** วันของรอบ (Bangkok "YYYY-MM-DD") — client รวมรอบตั้งต้นต่อสาขา/วัน */
  dayKey: string;
  /** true = server ตั้งธง anomaly จริง (anomalyFlags.length>0) — ใช้ filter "มีปัญหา" ให้ซื่อสัตย์
   *  (จับรอบ ANOMALY_REVIEW ที่ gap จอเล็กจนดูเหมือนตรง) */
  hasAnomaly: boolean;
  /** รอบตั้งต้น (baseline) — ตั้งค่ามิเตอร์ครั้งแรกของตู้ · ยังไม่มีรอบก่อนไว้เทียบ →
   *  ห้ามจัดเป็น "ไม่ตรง/เกิน" (expectedCash=0 โดยธรรมชาติ ทำให้ดูเหมือนเงินเกินทั้งที่ปกติ) */
  isBaseline: boolean;
  /** รอบ "กำลังเก็บ" (OPEN · ยังเก็บไม่ครบทุกตู้) — โชว์สดแต่ยังไม่กระทบยอด (CEO 2026-08-01) */
  isOpen: boolean;
  /** เก็บแล้วกี่ตู้ในรอบ (COLLECTION) — โชว์ "X/Y" บนรอบ OPEN */
  collectedCount: number;
  /** ตู้คีบใช้งานได้ทั้งสาขา (Y ใน "X/Y") — เฉพาะรอบ OPEN (อื่น = 0) */
  machineTotal: number;
  /** มิเตอร์เหรียญรวมทั้งรอบ (จาก event จริง) — null = ไม่มี event ให้ derive */
  coinMeterBefore: number | null;
  coinMeterAfter: number | null;
  /** ตู้ในรอบ + รูปจริงต่อตู้ (anti-cheat) */
  machines: Machine[];
};

/** ผลลัพธ์แบบแบ่งหน้าของ getV2AllRounds */
export type V2AllRoundsResult = {
  rounds: V2Round[];
  total: number; // จำนวนรอบทั้งหมดในช่วง (ก่อนตัดหน้า)
  page: number;
  pageSize: number;
};

/**
 * ดึง "รอบเก็บทั้งหมด" ที่ปิดแล้วในช่วงเวลา (default 30 วันล่าสุด) · แบ่งหน้ากัน payload บาน.
 * @param opts.branchId  กรองสาขา (ถ้าอยู่นอก scope → คืนว่าง)
 * @param opts.from/to   ช่วงวันที่ (ISO) · ไม่ใส่ = 30 วันล่าสุด
 * @param opts.page      หน้า (เริ่ม 1) · pageSize คงที่ ~50
 */
export async function getV2AllRounds(opts?: {
  branchId?: string;
  from?: Date;
  to?: Date;
  page?: number;
}): Promise<V2AllRoundsResult> {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);
  const branchWhere = effectiveBranchWhere(branchIds, opts?.branchId);

  const pageSize = 50;
  const page = Math.max(1, Math.floor(opts?.page ?? 1));

  const from = opts?.from ?? (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    d.setHours(0, 0, 0, 0);
    return d;
  })();
  const to = opts?.to;

  // ช่วงวันที่: รอบปิดแล้วยึด closedAt · รอบ "กำลังเก็บ" (OPEN · closedAt=null) ยึด openedAt
  //   เดิม closedAt:{gte} ทิ้งรอบ OPEN ทั้งหมด (null ไม่ผ่าน range) → เงินที่กำลังเก็บล่องหน
  const range: { gte: Date; lte?: Date } = { gte: from };
  if (to) range.lte = to;

  const where = {
    orgId,
    status: { in: [...VISIBLE_STATUSES] },
    OR: [
      { closedAt: range },
      { status: "OPEN" as const, openedAt: range },
    ],
    ...(branchWhere ? { branchId: branchWhere } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.cfCollectionSession.count({ where }),
    prisma.cfCollectionSession.findMany({
      where,
      include: {
        branch: { select: { name: true, code: true } },
        openedBy: { select: { name: true } },
        events: {
          // รวม INITIAL (รอบตั้งต้น) ด้วย — ไม่งั้นรอบตั้งต้นไม่มีตู้/รูปให้ดู (โชว์ "ยังไม่มีข้อมูล").
          // รอบปกติมีแต่ COLLECTION อยู่แล้ว (INITIAL เกิดเฉพาะ flow ตั้งต้น) → ไม่กระทบ.
          where: { eventType: { in: ["COLLECTION", "INITIAL"] } },
          include: { machine: { select: { code: true, nickname: true, kind: true } } },
          orderBy: { collectedAt: "asc" },
        },
      },
      // OPEN ไม่มี closedAt → เรียงด้วย openedAt (สากลทุกสถานะ · รอบที่เพิ่งขยับอยู่บน)
      orderBy: { openedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  // จำนวนตู้คีบใช้งานได้ต่อสาขา — โชว์ "เก็บแล้ว X/Y ตู้" บนรอบที่กำลังเก็บ (OPEN)
  const openBranchIds = [
    ...new Set(rows.filter((s) => s.status === "OPEN" && s.branchId).map((s) => s.branchId as string)),
  ];
  const machineCountByBranch = new Map<string, number>();
  if (openBranchIds.length > 0) {
    const counts = await prisma.cfMachine.groupBy({
      by: ["branchId"],
      where: { orgId, branchId: { in: openBranchIds }, kind: "CLAW", isActive: true },
      _count: { _all: true },
    });
    for (const c of counts) if (c.branchId) machineCountByBranch.set(c.branchId, c._count._all);
  }

  // ราคาต่อครั้งจริงต่อตู้ (loadout ปัจจุบัน) — ต้องใช้ราคาเดียวกับตอนปิดรอบ ไม่งั้นตู้ราคาอื่น
  // (฿20/฿30) จะขึ้น "ต้องตรวจ" หลอกในการนับ ตรง/ต้องตรวจ (จุด 2). ตู้ไม่มี loadout → flat ฿10.
  const allMachineIds = [
    ...new Set(rows.flatMap((s) => s.events.map((e) => e.machineId))),
  ];
  const priceByMachine = new Map<string, number>();
  if (allMachineIds.length > 0) {
    const priced = await prisma.cfMachine.findMany({
      where: { orgId, id: { in: allMachineIds } },
      select: {
        id: true,
        loadouts: { where: { effectiveTo: null }, take: 1, orderBy: { effectiveFrom: "desc" }, select: { pricePerPlayCoins: true } },
      },
    });
    for (const m of priced) priceByMachine.set(m.id, m.loadouts[0] ? m.loadouts[0].pricePerPlayCoins * 1000 : 1000);
  }

  const rounds: V2Round[] = rows.map((s): V2Round => {
    const isOpen = s.status === "OPEN";
    // รอบ OPEN: snapshot (expected/actual/total) ยังไม่คำนวณ (คิดตอนปิดรอบ) → บวกเงินรายตู้จริงเอง.
    //   actualCashCents = Σ cashCountedCents เป๊ะ (validation.ts:269) → รอบปิดใช้ snapshot ได้เลขเท่ากัน ไม่ขยับของเก่า.
    const actualFromEvents = Math.round(
      s.events.reduce((sum, e) => sum + (e.cashCountedCents ?? 0), 0) / 100,
    );
    const expectedCash = isOpen ? 0 : Math.round((s.expectedCashCents ?? 0) / 100);
    const actualCash = isOpen
      ? actualFromEvents
      : Math.round((s.actualCashCents ?? s.totalCashCents ?? 0) / 100);
    const gap = isOpen ? 0 : expectedCash - actualCash; // + = ขาด · − = เกิน
    const gapPct = expectedCash > 0 ? (Math.abs(gap) / expectedCash) * 100 : 0;
    const prizeGap = isOpen ? 0 : s.prizeVariance ?? 0;
    const closed = s.closedAt ?? s.openedAt;
    // วันของรอบ (Bangkok) — client ใช้รวมรอบตั้งต้นต่อสาขา/วัน (CEO 2026-08-02: การ์ดรวม กดกาง)
    const dayKey = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(closed);

    // รอบ "สะอาด" = เงินต่างไม่เกินเกณฑ์ + ตุ๊กตาไม่หาย → severity P2 · type ตามเงิน
    // (กัน severityOf คืน P1 จาก gapPct>8 ทั้งที่ |gap| เล็ก · หน้าจอโชว์ "ตรงกัน" ระดับ P1 = ขัดกัน)
    const isClean = Math.abs(gap) <= CASH_TOLERANCE_BAHT && prizeGap === 0;
    const severity: "P0" | "P1" | "P2" = isClean ? "P2" : severityOf(gapPct, prizeGap);
    // type = ตุ๊กตาหาย เฉพาะเมื่อตุ๊กตาหายจริง (prizeGap>0) · ไม่งั้นถือเป็นสายเงิน
    const type: "cash_short" | "prize_short" = prizeGap > 0 ? "prize_short" : "cash_short";

    // แสดง "ทุกตู้ในรอบ" — คีบ + ตู้แลกเหรียญ + รอบตั้งต้น (CEO: เห็นข้อมูล+รูปครบทุกอย่าง).
    // เดิมกรองเฉพาะ CLAW → ตู้แลกและรอบตั้งต้นถูกซ่อน. eventToMachine จัดรูป/ข้อมูลตาม kind ให้เอง.
    const machines: Machine[] = s.events.map((e) => eventToMachine(e, priceByMachine.get(e.machineId) ?? 1000));

    // มิเตอร์เหรียญรวมทั้งรอบจาก event จริง (ทุก kind — เหรียญเข้าตู้คีบ+เครื่องแลก)
    // before = ผลรวม coinMeterBefore · after = ผลรวม coinMeterAfter → delta×10 = ควรได้จริง
    const meterEvents = s.events;
    const coinMeterBefore = meterEvents.length > 0
      ? meterEvents.reduce((sum, e) => sum + e.coinMeterBefore, 0)
      : null;
    const coinMeterAfter = meterEvents.length > 0
      ? meterEvents.reduce((sum, e) => sum + e.coinMeterAfter, 0)
      : null;

    return {
      id: s.sessionCode,
      branchId: s.branchId ?? "",
      branchName: s.branch?.name ?? "",
      branchCode: s.branch?.code ?? "",
      staff: s.openedBy.name,
      when: `${thaiTime(closed)} · ${thaiDateShort(closed)}`,
      timeAgo: timeAgo(closed),
      status: s.status,
      expectedCash,
      actualCash,
      gap,
      prizeExpected: isOpen ? 0 : s.prizeMeterOut ?? 0,
      prizeActual: isOpen ? 0 : s.prizeCountedOut ?? 0,
      prizeGap,
      severity,
      type,
      reason: s.anomalyFlags[0] ?? "",
      dayKey,
      // ธงจริงจาก server (ไม่ใช่คำนวณจาก gap ฝั่งจอ) — ให้ filter "มีปัญหา" จับรอบที่ ANOMALY_REVIEW
      // ที่ |gap| เล็กจนจอเห็นเป็น "ตรงกัน" (เช่น M5 มิเตอร์เสีย · per-machine netting) ได้ครบ
      hasAnomaly: s.anomalyFlags.length > 0,
      isBaseline: s.isBaseline,
      isOpen,
      collectedCount: s.events.filter((e) => e.eventType === "COLLECTION").length,
      machineTotal: machineCountByBranch.get(s.branchId ?? "") ?? 0,
      coinMeterBefore,
      coinMeterAfter,
      machines,
    };
  });

  return { rounds, total, page, pageSize };
}

/** สรุปกิจกรรมรายวันต่อสาขา (CEO 2026-08-01) — วันนี้แต่ละสาขาเก็บกี่ตู้/ยังไม่เก็บ/ตั้งค่าใหม่/เติมตุ๊กตา + เงินเก็บ */
export type DaySummary = {
  branchId: string;
  totalMachines: number; // ตู้คีบใช้งานได้ทั้งสาขา
  collected: number;     // เก็บเงินแล้ววันนี้ (ตู้ · distinct · เฉพาะที่ยัง active)
  notCollected: number;  // ยังไม่ได้เก็บวันนี้ (total − collected)
  baseline: number;      // ตั้งค่าตู้ครั้งแรกวันนี้ (ตู้ · distinct)
  refill: number;        // เติม/เปลี่ยนตุ๊กตาวันนี้ (ตู้ · distinct · refillQty>0)
  cashBaht: number;      // เงินที่เก็บได้วันนี้รวม (COLLECTION)
};

/**
 * สรุปรายวันต่อสาขาสำหรับหน้ากระทบยอด — ใช้เฉพาะเมื่อเลือก "ช่วงวันเดียว".
 * ช่วงหลายวัน → คืน null (การ์ดรายวันไม่ขึ้น · กันตัวเลข "รายวัน" ปนกับช่วง 30 วัน).
 * scope: org + สาขาของ user เท่านั้น (RLS-safe เหมือน query อื่น).
 */
export async function getDaySummaries(from: Date, to: Date): Promise<DaySummary[] | null> {
  // ช่วงเกิน ~1.5 วัน = มองเป็นหลายวัน → ไม่สรุปรายวัน
  if (to.getTime() - from.getTime() > 36 * 3600 * 1000) return null;

  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);
  const branchFilter = branchIds === "ALL" ? {} : { branchId: { in: branchIds } };

  const [machines, events] = await Promise.all([
    prisma.cfMachine.findMany({
      where: { orgId, kind: "CLAW", isActive: true, ...branchFilter },
      select: { id: true, branchId: true },
    }),
    prisma.cfCollectionEvent.findMany({
      where: {
        orgId,
        collectedAt: { gte: from, lte: to },
        eventType: { in: ["COLLECTION", "INITIAL"] },
        machine: { kind: "CLAW", ...branchFilter },
      },
      select: {
        machineId: true, eventType: true, cashCountedCents: true, refillQty: true,
        machine: { select: { branchId: true } },
      },
    }),
  ]);

  type Agg = { active: Set<string>; collected: Set<string>; baseline: Set<string>; refill: Set<string>; cashCents: number };
  const per = new Map<string, Agg>();
  const get = (bid: string): Agg => {
    let a = per.get(bid);
    if (!a) { a = { active: new Set(), collected: new Set(), baseline: new Set(), refill: new Set(), cashCents: 0 }; per.set(bid, a); }
    return a;
  };

  for (const m of machines) if (m.branchId) get(m.branchId).active.add(m.id);
  for (const e of events) {
    const bid = e.machine.branchId;
    if (!bid) continue;
    const a = get(bid);
    if (e.eventType === "COLLECTION") {
      a.collected.add(e.machineId);
      a.cashCents += e.cashCountedCents;
      if ((e.refillQty ?? 0) > 0) a.refill.add(e.machineId);
    } else {
      a.baseline.add(e.machineId);
    }
  }

  const out: DaySummary[] = [];
  for (const [branchId, a] of per) {
    const total = a.active.size;
    // นับ "เก็บแล้ว" เฉพาะตู้ที่ยัง active (ตู้ที่ปลดไปแล้วไม่เข้า total → กัน notCollected ติดลบ)
    let collectedActive = 0;
    for (const id of a.collected) if (a.active.has(id)) collectedActive++;
    out.push({
      branchId,
      totalMachines: total,
      collected: collectedActive,
      notCollected: Math.max(0, total - collectedActive),
      baseline: a.baseline.size,
      refill: a.refill.size,
      cashBaht: Math.round(a.cashCents / 100),
    });
  }
  return out;
}

/**
 * org (+scope สาขาของ user) นี้ "เคยมีรอบเก็บใด ๆ" ไหม — ทุกสถานะ · ทุกช่วงเวลา.
 * ใช้แยก "ยังไม่เคยเก็บเลย" (โชว์ตัวอย่าง) ออกจาก "เคยเก็บแล้ว" (empty-state จริง).
 * ต่างจาก total ใน getV2AllRounds ที่นับเฉพาะรอบปิดใน 30 วัน — org ที่มีรอบจริง
 * แต่เกิน 30 วัน/ยัง OPEN ต้องไม่ถูกหลอกให้เห็นตัวอย่างปลอม.
 */
export async function orgHasAnyRounds(): Promise<boolean> {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);
  const count = await prisma.cfCollectionSession.count({
    where: {
      orgId,
      ...(branchIds === "ALL" ? {} : { branchId: { in: branchIds } }),
    },
  });
  return count > 0;
}

/** หา anomaly เดียวตาม sessionCode (drill-in จาก Anomaly inbox · scope org+branch) */
export async function getV2Anomaly(sessionCode: string): Promise<Anomaly | null> {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);

  const s = await prisma.cfCollectionSession.findFirst({
    where: {
      orgId,
      sessionCode,
      ...(branchIds === "ALL" ? {} : { branchId: { in: branchIds } }),
    },
    include: {
      branch: { select: { name: true, code: true } },
      openedBy: { select: { name: true } },
      events: {
        where: { eventType: "COLLECTION" },
        include: { machine: { select: { code: true, nickname: true, kind: true } } },
        orderBy: { collectedAt: "asc" },
      },
    },
  });
  if (!s) return null;

  const expectedCash = Math.round((s.expectedCashCents ?? 0) / 100);
  const actualCash = Math.round((s.actualCashCents ?? s.totalCashCents ?? 0) / 100);
  // gap เก็บทิศทาง: บวก = ขาด · ลบ = เกิน (ดู listV2Anomalies)
  const gap = expectedCash - actualCash;
  const gapPct = expectedCash > 0 ? (Math.abs(gap) / expectedCash) * 100 : 0;
  const prizeGap = s.prizeVariance ?? 0;
  const opened = s.openedAt;
  const closed = s.closedAt ?? s.openedAt;
  const durMin = Math.max(1, Math.round((closed.getTime() - opened.getTime()) / 60000));
  const isCash = gap > 0;
  const machines: Machine[] = s.events
    .filter((e) => e.machine.kind === "CLAW")
    .map((e) => eventToMachine(e));
  const branchName = s.branch?.name ?? "";
  const branchCode = s.branch?.code ?? "";
  const machineName = machines[0]?.name ?? "";

  return {
    id: s.sessionCode,
    branchId: s.branchId ?? "",
    branchName,
    branchCode,
    machineName,
    severity: severityOf(gapPct, prizeGap),
    type: isCash ? "cash_short" : "prize_short",
    typeLabel: isCash ? "เงินขาด" : "ตุ๊กตาหาย",
    reason: s.anomalyFlags[0] ?? (isCash ? "เงินที่เก็บได้น้อยกว่าเลขมิเตอร์" : "ตุ๊กตาที่นับน้อยกว่าที่ระบบคำนวณ"),
    expectedCash,
    actualCash,
    gap,
    gapPct,
    prizeExpected: s.prizeMeterOut ?? 0,
    prizeActual: s.prizeCountedOut ?? 0,
    prizeGap,
    sessionStart: thaiTime(opened),
    sessionEnd: thaiTime(closed),
    duration: `${durMin} นาที`,
    timeAgo: timeAgo(closed),
    timestamp: `${thaiTime(closed)} · ${thaiDateShort(closed)}`,
    staff: s.openedBy.name,
    staffAvatar: firstChar(s.openedBy.name),
    machines,
  };
}

// =============================================================
// Session detail (ไส้ในรายรอบ) — drill-in จากหน้า Operations
// รับ sessionCode → คืน SessionDetail (ทุก status · ไม่ใช่แค่ ANOMALY_REVIEW)
// =============================================================

/** format เลขมี comma (ฝั่ง server · display string) */
const nfmt = (n: number) => n.toLocaleString("en-US");

/**
 * map CfCollectionEvent → Machine (shape เดียวกับ anomaly).
 * รู้จัก 3 แบบตาม (eventType, machine.kind) — รูปหลักฐาน + "ข้อมูลที่กรอก" ต่างกันคนละช่อง:
 *   • INITIAL (รอบตั้งต้น)      — 7 ช่องรูป (ตู้/มิเตอร์เงินบน-ล่าง/มิเตอร์ตุ๊กตาบน-ล่าง/ตุ๊กตาก่อน-หลัง) + มิเตอร์ N1
 *   • COLLECTION · EXCHANGER    — 3 ช่องรูป (มิเตอร์เหรียญ/เงินสด/ถาดเหรียญ) + เหรียญโปร
 *   • COLLECTION · CLAW         — 5 ช่องรูป (เดิม) + สต็อก/เหตุผลเงินขาด
 * ⚠️ COLUMN→CONTENT MAPPING: ชื่อ column ไม่ตรง content — อ่านตามตารางใน actions.ts / baseline-actions.ts
 */
function eventToMachine(e: {
  id: string;
  eventType: string;
  machine: { code: string; nickname: string | null; kind: string };
  coinMeterBefore: number;
  coinMeterAfter: number;
  cashCountedCents: number;
  stockBefore: number | null;
  stockAfter: number | null;
  refillQty: number | null;
  dollMeterBefore: number | null;
  dollMeterAfter: number | null;
  meterMoneyTop: number | null;
  meterMoneyBottom: number | null;
  meterDollTop: number | null;
  meterDollBottom: number | null;
  promoCoinsDispensed: number | null;
  shortReason: string | null;
  photoMeterBeforeUrl: string | null;
  photoPrizeMeterUrl: string | null;
  photoCashUrl: string | null;
  photoMeterAfterUrl: string | null;
  photoStockUrl: string | null;
  photoMachineUrl: string | null;
  photoMoneyMeterTopUrl: string | null;
  photoMoneyMeterBottomUrl: string | null;
  photoDollMeterTopUrl: string | null;
  photoDollMeterBottomUrl: string | null;
  anomalyFlags: string[];
  notes: string | null;
}, priceCents: number = 1000): Machine {
  const isInitial = e.eventType === "INITIAL";
  const kind = e.machine.kind;
  const cashBaht = Math.round(e.cashCountedCents / 100);

  let photoShots: { label: string; url: string | null }[];
  const entered: { k: string; v: string; tone?: "ok" | "bad" }[] = [];

  if (isInitial) {
    // รอบตั้งต้น (baseline · INITIAL) — CEO 2026-08-02: รูปมิเตอร์ตั้งต้น = 2 รูป (จอดิจิตอล + แผงเฟือง)
    //   จอดิจิตอล → photoMoneyMeterTopUrl · แผงเฟือง → photoMoneyMeterBottomUrl (ช่อง DB เดิม)
    //   คอลัมน์ Doll เก่าเก็บไว้แสดง baseline รุ่นก่อน (ถ้ามี · รุ่นใหม่ null → ซ่อนเอง)
    photoShots = [
      { label: "รูปตู้ทั้งตัว", url: e.photoMachineUrl },
      { label: "จอดิจิตอล (เหรียญ+ตุ๊กตา)", url: e.photoMoneyMeterTopUrl },
      { label: "แผงเฟือง (เหรียญ+ตุ๊กตา)", url: e.photoMoneyMeterBottomUrl },
      { label: "มิเตอร์ตุ๊กตา · ดิจิตอล (เดิม)", url: e.photoDollMeterTopUrl },
      { label: "มิเตอร์ตุ๊กตา · เฟือง (เดิม)", url: e.photoDollMeterBottomUrl },
      { label: "ตุ๊กตาก่อนใส่", url: e.photoStockUrl },
      { label: "ตุ๊กตาหลังใส่", url: e.photoMeterBeforeUrl },
    ];
    // กฎถาวร (b54b497f): บน=ดิจิตอล · ล่าง=เฟือง (เดิมป้ายสลับ · แก้ให้ตรงกฎ · ไม่แตะค่า)
    if (e.meterMoneyTop != null) entered.push({ k: "มิเตอร์เงิน · บน (ดิจิตอล)", v: nfmt(e.meterMoneyTop) });
    if (e.meterMoneyBottom != null) entered.push({ k: "มิเตอร์เงิน · ล่าง (เฟือง)", v: nfmt(e.meterMoneyBottom) });
    if (e.meterDollTop != null) entered.push({ k: "มิเตอร์ตุ๊กตา · บน (ดิจิตอล)", v: nfmt(e.meterDollTop) });
    if (e.meterDollBottom != null) entered.push({ k: "มิเตอร์ตุ๊กตา · ล่าง (เฟือง)", v: nfmt(e.meterDollBottom) });
    entered.push({ k: "เงินสดตั้งต้น", v: `฿${nfmt(cashBaht)}` });
    if (e.stockAfter != null) entered.push({ k: "ตุ๊กตาในตู้ (ตั้งต้น)", v: `${nfmt(e.stockAfter)} ตัว` });
    if (e.refillQty != null && e.refillQty > 0) entered.push({ k: "เติมตุ๊กตา", v: `${nfmt(e.refillQty)} ตัว` });
  } else if (kind === "EXCHANGER") {
    // ตู้แลกเหรียญ (ดู actions.ts ~1388)
    photoShots = [
      { label: "มิเตอร์เหรียญ", url: e.photoMeterAfterUrl },
      { label: "เงินสด", url: e.photoCashUrl },
      { label: "ถาดเหรียญ", url: e.photoMeterBeforeUrl },
    ];
    entered.push({ k: "มิเตอร์เหรียญ (ก่อน → หลัง)", v: `${nfmt(e.coinMeterBefore)} → ${nfmt(e.coinMeterAfter)}` });
    entered.push({ k: "เงินสดนับได้", v: `฿${nfmt(cashBaht)}` });
    if (e.promoCoinsDispensed != null) entered.push({ k: "เหรียญโปรที่จ่าย", v: nfmt(e.promoCoinsDispensed) });
  } else {
    // ตู้คีบ (CLAW · COLLECTION) — CEO 2026-08-02: รูปมิเตอร์เหลือ 2 (จอดิจิตอล + แผงเฟือง · แต่ละรูปเห็นเหรียญ+ตุ๊กตา)
    //   photoMeterAfterUrl = จอดิจิตอล · photoPrizeMeterUrl = แผงเฟือง (ช่อง DB เดิม · relabel ตาม 2-photo model)
    photoShots = [
      { label: "จอดิจิตอล (เหรียญ+ตุ๊กตา)", url: e.photoMeterAfterUrl },
      { label: "แผงเฟือง (เหรียญ+ตุ๊กตา)", url: e.photoPrizeMeterUrl },
      { label: "สต็อกก่อนเติม", url: e.photoStockUrl },
      { label: "สต็อกหลังเติม", url: e.photoMeterBeforeUrl },
      // CEO 2026-08-02 · ตัดรูปเงินสดออกถาวร (ไม่มีการถ่ายรูปเงินสดแล้ว)
    ];
    entered.push({ k: "มิเตอร์เหรียญ · ดิจิตอล (ก่อน → หลัง)", v: `${nfmt(e.coinMeterBefore)} → ${nfmt(e.coinMeterAfter)}` });
    if (e.meterMoneyTop != null) entered.push({ k: "มิเตอร์เหรียญ · เฟือง (หลัง)", v: nfmt(e.meterMoneyTop) });
    entered.push({ k: "เงินสดนับได้", v: `฿${nfmt(cashBaht)}` });
    if (e.dollMeterBefore != null || e.dollMeterAfter != null) {
      entered.push({ k: "มิเตอร์ตุ๊กตา · ดิจิตอล (ก่อน → หลัง)", v: `${nfmt(e.dollMeterBefore ?? 0)} → ${nfmt(e.dollMeterAfter ?? 0)}` });
    }
    if (e.meterDollTop != null) entered.push({ k: "มิเตอร์ตุ๊กตา · เฟือง (หลัง)", v: nfmt(e.meterDollTop) });
    if (e.stockBefore != null || e.stockAfter != null) {
      entered.push({ k: "ตุ๊กตาในตู้ (ก่อน → หลังเติม)", v: `${nfmt(e.stockBefore ?? 0)} → ${nfmt(e.stockAfter ?? 0)} ตัว` });
    }
    if (e.refillQty != null && e.refillQty > 0) entered.push({ k: "เติมตุ๊กตา", v: `${nfmt(e.refillQty)} ตัว` });
    if (e.shortReason) entered.push({ k: "เหตุผลเงินขาด", v: e.shortReason });
  }
  // หมายเหตุพนักงาน — ต่อท้ายเสมอถ้ามี (ทุกแบบตู้)
  { const cn = cleanNote(e.notes); if (cn) entered.push({ k: "หมายเหตุ", v: cn }); }

  // ── กระทบยอดต่อตู้ (CEO 2026-08-02 · จุด 2+3) — เฉพาะ COLLECTION (รอบตั้งต้นไม่มีของก่อนเทียบ)
  //   ใช้ deriveEvent (validator ตัวเดียวกับ server) + ราคาต่อครั้งจริง (priceCents) → ผลลัพธ์ตรง server 100%
  //   cashOff = ธงกลุ่มเงิน/มิเตอร์ (M*/C*/A*/G*) · prizeOff = ธงกลุ่มตุ๊กตา (P*)
  //   → ลงสีแถวข้อมูล (เขียว=ตรง แดง=ต้องตรวจ) + ให้ client นับ "ตรง/ต้องตรวจ" โดยไม่คำนวณเงินซ้ำ
  let reconcile: { cashOff: boolean; prizeOff: boolean } | null = null;
  if (!isInitial && (kind === "CLAW" || kind === "EXCHANGER")) {
    const d = deriveEvent({
      kind: kind === "EXCHANGER" ? "EXCHANGER" : "CLAW",
      coinMeterBefore: e.coinMeterBefore,
      coinMeterAfter: e.coinMeterAfter,
      cashCountedCents: e.cashCountedCents,
      dollMeterBefore: e.dollMeterBefore,
      dollMeterAfter: e.dollMeterAfter,
      stockBefore: e.stockBefore,
      stockAfter: e.stockAfter,
      refillQty: e.refillQty,
      promoCoinsDispensed: e.promoCoinsDispensed,
      cashPerCoinCents: priceCents,
    });
    const prizeOff = d.flags.some((f) => f.startsWith("P"));
    const cashOff = d.flags.some((f) => !f.startsWith("P")); // ธงอื่นทั้งหมด = เงิน/มิเตอร์
    reconcile = { cashOff, prizeOff };
    // ลงสีแถว: แถวเงิน/มิเตอร์เหรียญ → tone ตาม cashOff · แถวตุ๊กตา → tone ตาม prizeOff
    for (const rw of entered) {
      if (rw.k.includes("ตุ๊กตา")) rw.tone = prizeOff ? "bad" : "ok";
      else if (rw.k.includes("เงิน") || rw.k.includes("เหรียญ")) rw.tone = cashOff ? "bad" : "ok";
    }
  }

  const photos = photoShots.filter((p) => p.url).length;
  return {
    eventId: e.id,
    code: e.machine.code,
    name: e.machine.nickname ?? e.machine.code,
    kind,
    isInitial,
    meterBefore: e.coinMeterBefore,
    meterAfter: e.coinMeterAfter,
    coinRate: 10,
    prizeBefore: e.stockBefore ?? 0,
    prizeAfter: e.stockAfter ?? 0,
    refilled: e.refillQty ?? 0,
    skuMix: "",
    cashIn: cashBaht,
    prizeMeterPrev: e.dollMeterBefore ?? 0,
    prizeMeterNow: e.dollMeterAfter ?? 0,
    // เฟือง (COLLECTION: meterMoneyTop/meterDollTop) — ให้ฟอร์มแก้เลขโชว์/แก้ 4 มิเตอร์ครบ
    coinGear: e.meterMoneyTop,
    dollGear: e.meterDollTop,
    priceCents, // ราคาต่อครั้ง (ฟอร์มแก้คำนวณเงินควรได้/หายสด)
    photos,
    photoShots,
    entered,
    reconcile,
    flag: e.anomalyFlags.length > 0,
    note: cleanNote(e.notes) ?? undefined,
  };
}

const SESSION_STATUS_LABEL: Record<SessionDetailStatus, string> = {
  active: "กำลังเก็บ",
  stale: "ค้างนาน",
  review: "รอตรวจ",
  closed: "ปิดแล้ว",
  locked: "ล็อกแล้ว",
};

/** ไส้ในของรอบเดียว — หา session ตาม sessionCode (scope ด้วย org + branch ของ user) */
export async function getV2SessionDetail(sessionCode: string): Promise<SessionDetail | null> {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);

  const s = await prisma.cfCollectionSession.findFirst({
    where: {
      orgId,
      sessionCode,
      ...(branchIds === "ALL" ? {} : { branchId: { in: branchIds } }),
    },
    include: {
      branch: { select: { id: true, name: true, code: true, province: true, region: true, _count: { select: { cfMachines: { where: { isActive: true } } } } } },
      openedBy: { select: { name: true } },
      closedBy: { select: { name: true } },
      events: {
        where: { eventType: "COLLECTION" },
        include: { machine: { select: { code: true, nickname: true, kind: true } } },
        orderBy: { collectedAt: "asc" },
      },
    },
  });
  if (!s) return null;

  const machines: Machine[] = s.events
    .filter((e) => e.machine.kind === "CLAW")
    .map((e) => eventToMachine(e));

  // cross-check รวม: ถ้า snapshot มีใน DB ใช้เลย · ไม่งั้นคำนวณจากรายตู้
  const expectedFromMachines = machines.reduce(
    (sum, m) => sum + (m.meterAfter - m.meterBefore) * m.coinRate, 0,
  );
  const actualFromMachines = machines.reduce((sum, m) => sum + m.cashIn, 0);
  const expectedCash = s.expectedCashCents != null
    ? Math.round(s.expectedCashCents / 100)
    : expectedFromMachines;
  const actualCash = s.actualCashCents != null
    ? Math.round(s.actualCashCents / 100)
    : (s.totalCashCents ? Math.round(s.totalCashCents / 100) : actualFromMachines);
  const cashGap = actualCash - expectedCash;

  // ตุ๊กตา: มิเตอร์บอกออก vs นับจริงหายไป
  const prizeExpected = s.prizeMeterOut != null
    ? s.prizeMeterOut
    : machines.reduce((sum, m) => sum + (m.prizeMeterNow - m.prizeMeterPrev), 0);
  const prizeActual = s.prizeCountedOut != null
    ? s.prizeCountedOut
    : machines.reduce((sum, m) => sum + (m.prizeBefore + m.refilled - m.prizeAfter), 0);
  const prizeGap = prizeActual - prizeExpected;

  const opened = s.openedAt;
  const closed = s.closedAt ?? null;
  const durEnd = closed ?? new Date();
  const durMin = Math.max(1, Math.round((durEnd.getTime() - opened.getTime()) / 60000));

  let status: SessionDetailStatus;
  if (s.status === "OPEN") {
    status = (Date.now() - opened.getTime()) > 3 * 3_600_000 ? "stale" : "active";
  } else if (s.status === "ANOMALY_REVIEW") {
    status = "review";
  } else if (s.status === "LOCKED") {
    status = "locked";
  } else {
    status = "closed";
  }

  const branchName = s.branch?.name ?? "";
  const branchCode = s.branch?.code ?? "";
  const branchArea = s.branch?.province ?? s.branch?.region ?? "";
  const machineTotal = s.branch?._count.cfMachines ?? machines.length;

  return {
    id: s.sessionCode,
    branchId: s.branchId ?? "",
    branchName,
    branchCode,
    branchArea,
    status,
    statusLabel: SESSION_STATUS_LABEL[status],
    staff: s.openedBy.name,
    staffAvatar: firstChar(s.openedBy.name),
    closedBy: s.closedBy?.name ?? undefined,
    openedAt: `${thaiTime(opened)} · ${thaiDateShort(opened)}`,
    closedAt: closed ? `${thaiTime(closed)} · ${thaiDateShort(closed)}` : undefined,
    duration: durMin >= 60 ? `${Math.floor(durMin / 60)} ชม. ${durMin % 60} นาที` : `${durMin} นาที`,
    machineCount: machineTotal,
    doneCount: machines.length,
    expectedCash,
    actualCash,
    cashGap,
    prizeExpected,
    prizeActual,
    prizeGap,
    hasAnomaly: s.status === "ANOMALY_REVIEW" || s.anomalyFlags.length > 0 || cashGap < 0,
    anomalyFlags: s.anomalyFlags,
    machines,
  };
}

// =============================================================
// Hub aggregate
// =============================================================
export async function getV2HubData(filter?: string): Promise<{
  today: TodaySummary;
  trend7d: TrendDay[];
  branchPerf: BranchPerf[];
  activeSessions: ActiveSession[];
  closedToday: ClosedSession[];
}> {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);
  const branchWhere = effectiveBranchWhere(branchIds, filter);
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const [closedRows, openRows, branches] = await Promise.all([
    prisma.cfCollectionSession.findMany({
      where: {
        orgId,
        status: { in: ["CLOSED", "ANOMALY_REVIEW", "LOCKED"] },
        closedAt: { gte: dayStart },
        ...(branchWhere ? { branchId: branchWhere } : {}),
      },
      include: { openedBy: { select: { name: true } }, _count: { select: { events: true } } },
      orderBy: { closedAt: "desc" },
    }),
    prisma.cfCollectionSession.findMany({
      where: { orgId, status: "OPEN", ...(branchWhere ? { branchId: branchWhere } : {}) },
      include: { openedBy: { select: { name: true } }, _count: { select: { events: true } }, branch: { select: { _count: { select: { cfMachines: true } } } } },
      orderBy: { openedAt: "asc" },
    }),
    getV2Branches(),
  ]);

  const revenue = closedRows.reduce((s, r) => s + r.totalCashCents, 0) / 100;
  const prizesOut = closedRows.reduce((s, r) => s + (r.prizeCountedOut ?? 0), 0);
  const anomaliesOpen = closedRows.filter((r) => r.status === "ANOMALY_REVIEW").length;

  const today: TodaySummary = {
    revenue,
    yesterdayRevenue: 0,
    sessions: closedRows.length,
    sessionsExpected: branches.length,
    anomaliesOpen,
    stockAlerts: 0,
    staffActive: new Set([...closedRows, ...openRows].map((r) => r.openedById)).size,
    staffTotal: branches.length,
    prizesOut,
  };

  // 7-day trend
  const trend7d: TrendDay[] = [];
  for (let i = 6; i >= 0; i--) {
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); d0.setDate(d0.getDate() - i);
    const d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
    // computed below in one pass would be ideal; kept simple per-day
    trend7d.push({
      day: new Intl.DateTimeFormat("th-TH", { weekday: "narrow", timeZone: "Asia/Bangkok" }).format(d0),
      date: thaiDateShort(d0),
      revenue: 0,
      anomaly: 0,
      today: i === 0,
    });
  }

  const branchPerf: BranchPerf[] = branches.map((b) => {
    const rows = closedRows.filter((r) => r.branchId === b.id);
    const rev = rows.reduce((s, r) => s + r.totalCashCents, 0) / 100;
    const anomaly = rows.filter((r) => r.status === "ANOMALY_REVIEW").length;
    const prizeOut = rows.reduce((s, r) => s + (r.prizeCountedOut ?? 0), 0);
    return {
      id: b.id, revenue: rev, change: 0, sessions: rows.length, anomaly, prizeOut,
      status: anomaly > 0 ? "attention" : "ok",
    };
  });

  const activeSessions: ActiveSession[] = openRows.map((s) => {
    const total = s.branch?._count.cfMachines ?? s._count.events;
    const elapsedMs = Date.now() - s.openedAt.getTime();
    const stale = elapsedMs > 3 * 3_600_000;
    return {
      id: s.sessionCode, branchId: s.branchId ?? "",
      machines: total, done: s._count.events,
      staff: s.openedBy.name, staffAvatar: firstChar(s.openedBy.name),
      elapsed: `${Math.floor(elapsedMs / 3_600_000)} ชม. ${Math.floor((elapsedMs % 3_600_000) / 60000)} นาที`,
      startedAt: thaiTime(s.openedAt), stale,
    };
  });

  const closedToday: ClosedSession[] = closedRows
    .filter((r) => r.status === "CLOSED")
    .map((s) => ({
      id: s.sessionCode, branchId: s.branchId ?? "",
      revenue: Math.round(s.totalCashCents / 100), machines: s._count.events,
      prizeOut: s.prizeCountedOut ?? 0,
      staff: s.openedBy.name, staffAvatar: firstChar(s.openedBy.name),
      closedAt: s.closedAt ? thaiTime(s.closedAt) : "—",
    }));

  return { today, trend7d, branchPerf, activeSessions, closedToday };
}

// =============================================================
// Insights rows (recent sessions)
// =============================================================
export async function getV2Insights(filter?: string, days = 7): Promise<InsightRow[]> {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);
  const branchWhere = effectiveBranchWhere(branchIds, filter);
  const since = new Date(); since.setDate(since.getDate() - days);

  const rows = await prisma.cfCollectionSession.findMany({
    where: {
      orgId,
      status: { in: ["CLOSED", "ANOMALY_REVIEW", "LOCKED"] },
      closedAt: { gte: since },
      ...(branchWhere ? { branchId: branchWhere } : {}),
    },
    include: { openedBy: { select: { name: true } } },
    orderBy: { closedAt: "desc" },
    take: 200,
  });

  return rows.map((s): InsightRow => {
    const isReview = s.status === "ANOMALY_REVIEW";
    const closed = s.closedAt ?? s.openedAt;
    return {
      time: `${thaiDateShort(closed)} ${thaiTime(closed)}`,
      id: s.sessionCode,
      branchId: s.branchId ?? "",
      staff: s.openedBy.name,
      expectedCash: Math.round((s.expectedCashCents ?? s.totalCashCents) / 100),
      actualCash: Math.round((s.actualCashCents ?? s.totalCashCents) / 100),
      prizeOut: s.prizeCountedOut ?? 0,
      status: isReview ? "review" : "ok",
      severity: isReview ? "P1" : undefined,
    };
  });
}

// =============================================================
// Stock per branch (warehouse + in-machine) + deliveries
// =============================================================
export async function getV2BranchStock(branchId: string): Promise<{
  stock: StockEntry[];
  deliveries: Delivery[];
}> {
  const session = await requireSession();
  const orgId = session.user.org_id;

  const [products, movements, machines, deliveries] = await Promise.all([
    prisma.cfProduct.findMany({ where: { orgId, isActive: true } }),
    prisma.cfStockMovement.findMany({ where: { orgId, branchId } }),
    prisma.cfMachine.findMany({ where: { orgId, branchId, kind: "CLAW", isActive: true }, select: { id: true, lastDollStock: true } }),
    prisma.cfDelivery.findMany({ where: { orgId, branchId, status: { in: ["SCHEDULED", "IN_TRANSIT"] } }, orderBy: { eta: "asc" } }),
  ]);

  const inMachineTotal = machines.reduce((s, m) => s + m.lastDollStock, 0);
  const stock: StockEntry[] = products.map((p) => {
    const movs = movements.filter((m) => m.productId === p.id);
    const warehouse = movs.filter((m) => !m.machineId).reduce((s, m) => s + m.qty, 0);
    const lastRecv = movs.filter((m) => m.type === "RECEIVE").sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
    return {
      sku: p.sku, name: p.name,
      warehouse: Math.max(0, warehouse),
      inMachines: Math.round(inMachineTotal / Math.max(1, products.length)),
      lastDelivery: lastRecv ? timeAgo(lastRecv.occurredAt) + "ก่อน" : "—",
      velocity: 4,
      cost: Math.round(p.unitCostCents / 100),
    };
  });

  const delivs: Delivery[] = deliveries.map((d) => ({
    id: d.id, branchId: d.branchId, items: d.itemsCount, units: d.unitsCount,
    eta: d.eta ? `${thaiDateShort(d.eta)} ${thaiTime(d.eta)}` : "—",
    status: d.status === "IN_TRANSIT" ? "in_transit" : "scheduled",
    from: d.fromLocation,
  }));

  return { stock, deliveries: delivs };
}
