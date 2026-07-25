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

/** สถานะรอบที่ "ปิดแล้ว" (นับเข้าหน้ากระทบยอด) — OPEN ไม่รวม เพราะยังเก็บไม่จบ */
const CLOSED_STATUSES = ["CLOSED", "ANOMALY_REVIEW", "LOCKED", "CANCELLED"] as const;

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
  /** รอบตั้งต้น (baseline) — ตั้งค่ามิเตอร์ครั้งแรกของตู้ · ยังไม่มีรอบก่อนไว้เทียบ →
   *  ห้ามจัดเป็น "ไม่ตรง/เกิน" (expectedCash=0 โดยธรรมชาติ ทำให้ดูเหมือนเงินเกินทั้งที่ปกติ) */
  isBaseline: boolean;
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

  const closedAtWhere: { gte: Date; lte?: Date } = { gte: from };
  if (to) closedAtWhere.lte = to;

  const where = {
    orgId,
    status: { in: [...CLOSED_STATUSES] },
    closedAt: closedAtWhere,
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
          where: { eventType: "COLLECTION" },
          include: { machine: { select: { code: true, nickname: true, kind: true } } },
          orderBy: { collectedAt: "asc" },
        },
      },
      orderBy: { closedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  const rounds: V2Round[] = rows.map((s): V2Round => {
    const expectedCash = Math.round((s.expectedCashCents ?? 0) / 100);
    const actualCash = Math.round((s.actualCashCents ?? s.totalCashCents ?? 0) / 100);
    const gap = expectedCash - actualCash; // + = ขาด · − = เกิน
    const gapPct = expectedCash > 0 ? (Math.abs(gap) / expectedCash) * 100 : 0;
    const prizeGap = s.prizeVariance ?? 0;
    const closed = s.closedAt ?? s.openedAt;

    // รอบ "สะอาด" = เงินต่างไม่เกินเกณฑ์ + ตุ๊กตาไม่หาย → severity P2 · type ตามเงิน
    // (กัน severityOf คืน P1 จาก gapPct>8 ทั้งที่ |gap| เล็ก · หน้าจอโชว์ "ตรงกัน" ระดับ P1 = ขัดกัน)
    const isClean = Math.abs(gap) <= CASH_TOLERANCE_BAHT && prizeGap === 0;
    const severity: "P0" | "P1" | "P2" = isClean ? "P2" : severityOf(gapPct, prizeGap);
    // type = ตุ๊กตาหาย เฉพาะเมื่อตุ๊กตาหายจริง (prizeGap>0) · ไม่งั้นถือเป็นสายเงิน
    const type: "cash_short" | "prize_short" = prizeGap > 0 ? "prize_short" : "cash_short";

    const clawEvents = s.events.filter((e) => e.machine.kind === "CLAW");
    const machines: Machine[] = clawEvents.map((e) => eventToMachine(e));

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
      prizeExpected: s.prizeMeterOut ?? 0,
      prizeActual: s.prizeCountedOut ?? 0,
      prizeGap,
      severity,
      type,
      reason: s.anomalyFlags[0] ?? "",
      isBaseline: s.isBaseline,
      coinMeterBefore,
      coinMeterAfter,
      machines,
    };
  });

  return { rounds, total, page, pageSize };
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

/** map CfCollectionEvent (COLLECTION · CLAW) → Machine (shape เดียวกับ anomaly) */
function eventToMachine(e: {
  id: string;
  machine: { code: string; nickname: string | null };
  coinMeterBefore: number;
  coinMeterAfter: number;
  cashCountedCents: number;
  stockBefore: number | null;
  stockAfter: number | null;
  refillQty: number | null;
  dollMeterBefore: number | null;
  dollMeterAfter: number | null;
  photoMeterBeforeUrl: string | null;
  photoPrizeMeterUrl: string | null;
  photoCashUrl: string | null;
  photoMeterAfterUrl: string | null;
  photoStockUrl: string | null;
  anomalyFlags: string[];
  notes: string | null;
}): Machine {
  // ⚠️ COLUMN→CONTENT MAPPING (ดู actions.ts ~244 · ชื่อ column ไม่ตรง content):
  //   photoMeterAfterUrl  = มิเตอร์เหรียญ      photoPrizeMeterUrl = มิเตอร์ตุ๊กตา
  //   photoStockUrl       = สต็อกก่อนเติม       photoMeterBeforeUrl = สต็อกหลังเติม
  //   photoCashUrl        = เงินสด
  const photoShots: { label: string; url: string | null }[] = [
    { label: "มิเตอร์เหรียญ", url: e.photoMeterAfterUrl },
    { label: "มิเตอร์ตุ๊กตา", url: e.photoPrizeMeterUrl },
    { label: "สต็อกก่อนเติม", url: e.photoStockUrl },
    { label: "สต็อกหลังเติม", url: e.photoMeterBeforeUrl },
    { label: "เงินสด", url: e.photoCashUrl },
  ];
  const photos = photoShots.filter((p) => p.url).length;
  return {
    eventId: e.id,
    code: e.machine.code,
    name: e.machine.nickname ?? e.machine.code,
    meterBefore: e.coinMeterBefore,
    meterAfter: e.coinMeterAfter,
    coinRate: 10,
    prizeBefore: e.stockBefore ?? 0,
    prizeAfter: e.stockAfter ?? 0,
    refilled: e.refillQty ?? 0,
    skuMix: "",
    cashIn: Math.round(e.cashCountedCents / 100),
    prizeMeterPrev: e.dollMeterBefore ?? 0,
    prizeMeterNow: e.dollMeterAfter ?? 0,
    photos,
    photoShots,
    flag: e.anomalyFlags.length > 0,
    note: e.notes ?? undefined,
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
