// ClawFleet · Checklist grid (สาขา × วัน) query layer — server-only. READ-ONLY.
//
// เมทริกซ์ "สาขา × วัน" เต็มเดือนปฏิทิน — ต่อสาขา ต่อวัน สรุปสถานะการเก็บเงิน + ยอดเงิน:
//   COLLECTED    = มีรอบปิดแล้ว (CLOSED/LOCKED/ANOMALY_REVIEW/OPEN) ที่เก็บเงินได้ (cash>0) แต่ยังไม่ฝากธนาคาร
//   DEPOSITED    = เก็บแล้ว + ฝากธนาคารแล้ว (รอบมี depositId)
//   REFILL_ONLY  = วันนั้นมีแต่การเติมตุ๊กตา (refillQty>0) ไม่มีการเก็บเงิน
//   NOT_COLLECTED= ไม่มีรอบ/ไม่มี event ในวันนั้น
//   NO_BASELINE  = สาขายังไม่มีตู้ที่ตั้ง baseline (isFirstBaselineLocked) เลย → ทั้งแถวเทา ⚪
//
// ⚪ NO_BASELINE = TONE.neutral (ไม่ใช่สีแดง) — "ยังไม่ตั้งค่า" ไม่ใช่ "ผิดพลาด".
//
// เดือนปฏิทินจริง (year/month + prev/next) + ยอดเก็บเงิน/วัน — ตรงกับ getReconcileChecklist
// (lib/chairops/queries/reconcile-v2.ts) เพื่อให้ month-nav/legend สอดคล้องกันทั้งสองโปรแกรม.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { requireSession, type Session } from "@/lib/auth/session";
import { userBranchIds } from "./role-guard";

/** สถานะการเก็บเงินของ 1 สาขา ใน 1 วัน */
export type CfChecklistStatus =
  | "COLLECTED"
  | "NOT_COLLECTED"
  | "REFILL_ONLY"
  | "DEPOSITED"
  | "NO_BASELINE";

/** ช่อง 1 สาขา × 1 วัน — สถานะ + ยอดเก็บเงินรวมวันนั้น (บาท) */
export type CfChecklistDayCell = {
  status: CfChecklistStatus;
  /** ยอดเก็บเงินรวมของวันนั้น (บาท) — 0 เมื่อไม่มีเก็บ/refill-only/no-baseline */
  amount: number;
};

export type CfChecklistBranch = {
  branchId: string;
  branchName: string;
  /** false → ทั้งแถวเป็น NO_BASELINE (สาขายังไม่มีตู้ตั้ง baseline) → เรนเดอร์เทา ⚪ */
  hasBaseline: boolean;
  /** cells[0] = วันที่ 1 ของเดือน ... cells[daysInMonth-1] = วันสุดท้าย */
  cells: CfChecklistDayCell[];
};

export type CfChecklistGrid = {
  year: number;
  month: number; // 1..12
  daysInMonth: number;
  monthLabel: string; // "สิงหาคม 2569"
  prevYm: string; // "YYYY-MM"
  nextYm: string;
  branches: CfChecklistBranch[];
};

/** raw row จาก groupBy สาขา×วัน */
type RawRow = {
  branch_id: string;
  iso_day: string;
  cash_cents: bigint | number | null;
  refills: bigint | number | null;
  deposits: bigint | number | null;
  events: bigint | number | null;
};

// raw IN-list ของ uuid (parameterized · กัน SQL injection)
function prismaInUuid(ids: string[]): Prisma.Sql {
  return Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
}

function toNum(v: bigint | number | null): number {
  if (v == null) return 0;
  return typeof v === "bigint" ? Number(v) : v;
}

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
];

/** เลื่อนเดือน (1-based) ไป delta เดือน → "YYYY-MM" — ตรงกับ shiftYm ใน reconcile-v2.ts */
function shiftYm(year: number, month: number, delta: number): string {
  const zero = month - 1 + delta;
  const y = year + Math.floor(zero / 12);
  const m = ((zero % 12) + 12) % 12;
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * เมทริกซ์ สาขา × วัน (checklist การเก็บเงิน) ของเดือนปฏิทิน (Asia/Bangkok) — ทุกสาขาในขอบเขต user.
 * READ-ONLY view → scope ด้วย userBranchIds (viewer/admin = "ALL") + orgId เสมอ.
 * - year/month: เดือนปฏิทินที่ต้องการ (1-12)
 * - branchIds: กรองเฉพาะสาขาที่ระบุ (subset ของ scope) ถ้าส่งมา
 */
export async function getCfChecklistGrid(input: {
  year: number;
  month: number;
  branchIds?: string[];
}): Promise<CfChecklistGrid> {
  const session: Session = await requireSession();
  const orgId = session.user.org_id;
  const scope = await userBranchIds(session);
  const { year, month } = input;
  const daysInMonth = new Date(year, month, 0).getDate(); // month 1-based → last day
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  const monthStart = new Date(`${ym}-01T00:00:00+07:00`);
  const monthEnd = new Date(`${shiftYm(year, month, 1)}-01T00:00:00+07:00`);

  // 1. สาขาคีบตุ๊กตา (claw_machine) ในขอบเขต user + กรอง input.branchIds ถ้ามี
  const branches = await prisma.branch.findMany({
    where: {
      orgId,
      businessType: "claw_machine",
      isActive: true,
      ...(scope === "ALL" ? {} : { id: { in: scope } }),
      ...(input.branchIds && input.branchIds.length > 0
        ? { id: { in: input.branchIds } }
        : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  if (branches.length === 0) {
    return {
      year, month, daysInMonth,
      monthLabel: `${THAI_MONTHS[month - 1]} ${year + 543}`,
      prevYm: shiftYm(year, month, -1),
      nextYm: shiftYm(year, month, 1),
      branches: [],
    };
  }

  const branchIds = branches.map((b) => b.id);

  // 2. สาขาไหน "มี baseline แล้ว" — มีตู้ ≥1 ตัวที่ isFirstBaselineLocked=true
  //    (แถวสาขาที่ไม่มีตู้ locked เลย → NO_BASELINE ทั้งแถว)
  const lockedRows = await prisma.cfMachine.groupBy({
    by: ["branchId"],
    where: {
      orgId,
      branchId: { in: branchIds },
      isFirstBaselineLocked: true,
    },
    _count: { _all: true },
  });
  const hasBaselineSet = new Set(
    lockedRows.filter((r) => r.branchId != null).map((r) => r.branchId as string),
  );

  // 3. รวมรายวันต่อสาขา (raw SQL · GROUP BY branch_id, iso_day) ในกรอบเดือนปฏิทินนี้
  //    - filter ช่วงเดือนด้วย collected_at ตรง (timestamptz) ก่อน แล้วค่อย group ด้วยวันไทย
  //    - cash_cents = เงินเก็บได้รวม/สาขา/วัน (เฉพาะรอบที่ปิดแล้ว/เปิดอยู่)
  //    - refills   = จำนวน event ที่ refill_qty > 0 (มีเติมตุ๊กตา)
  //    - deposits  = จำนวนรอบที่มี deposit_id (ฝากธนาคารแล้ว)
  //    - events    = จำนวน event ทั้งหมด (แยก "ไม่มีข้อมูล" ออกจาก "0 บาท")
  //    join sessions → กรองเฉพาะรอบปิดแล้ว (CLOSED/LOCKED/ANOMALY_REVIEW) + OPEN เหมือน matrix
  //    ⚠️ cf_collection_events ไม่มี branch_id → สาขามาจาก session (s.branch_id) เท่านั้น
  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT
      s.branch_id::text AS branch_id,
      to_char((e.collected_at AT TIME ZONE 'Asia/Bangkok')::date, 'YYYY-MM-DD') AS iso_day,
      SUM(e.cash_counted_cents)::bigint AS cash_cents,
      COUNT(*) FILTER (WHERE COALESCE(e.refill_qty, 0) > 0)::bigint AS refills,
      COUNT(DISTINCT s.id) FILTER (WHERE s.deposit_id IS NOT NULL)::bigint AS deposits,
      COUNT(*)::bigint AS events
    FROM cf_collection_events e
    JOIN cf_collection_sessions s ON s.id = e.session_id
    WHERE e.org_id = ${orgId}::uuid
      AND s.branch_id IN (${prismaInUuid(branchIds)})
      AND e.event_type = 'COLLECTION'
      -- + OPEN (กำลังเก็บ) — ตู้ที่เก็บวันนี้แม้รอบยังไม่ปิด ให้ขึ้นสถานะเก็บแล้ว (CEO 2026-08-01)
      AND s.status IN ('CLOSED', 'LOCKED', 'ANOMALY_REVIEW', 'OPEN')
      AND e.collected_at >= ${monthStart} AND e.collected_at < ${monthEnd}
    GROUP BY s.branch_id, iso_day
  `;

  // 4. ประกอบสถานะ+ยอดเงิน ต่อ (สาขา, index วันในเดือน 0-based)
  const byBranch = new Map<string, Map<number, CfChecklistDayCell>>();
  for (const r of rows) {
    const events = toNum(r.events);
    if (events === 0) continue;
    const cashCents = toNum(r.cash_cents);
    const refills = toNum(r.refills);
    const deposits = toNum(r.deposits);
    const dayIdx = Number(r.iso_day.slice(8, 10)) - 1; // "YYYY-MM-DD" → day-of-month 0-based
    if (dayIdx < 0 || dayIdx >= daysInMonth) continue; // เผื่อ edge ของ tz boundary

    let status: CfChecklistStatus;
    if (cashCents > 0) {
      // เก็บเงินได้ → ฝากแล้ว = DEPOSITED · ยังไม่ฝาก = COLLECTED
      status = deposits > 0 ? "DEPOSITED" : "COLLECTED";
    } else if (refills > 0) {
      // วันนั้นมีแต่การเติมตุ๊กตา ไม่มีเงิน → REFILL_ONLY
      status = "REFILL_ONLY";
    } else {
      // มี event แต่ไม่มีเงิน/ไม่มี refill (เช่น void/รอบเปล่า) → นับเป็นเก็บแล้วเงิน 0
      status = "COLLECTED";
    }

    let m = byBranch.get(r.branch_id);
    if (!m) {
      m = new Map();
      byBranch.set(r.branch_id, m);
    }
    m.set(dayIdx, { status, amount: cashCents / 100 });
  }

  // 5. ประกอบ output ต่อสาขา (เติม NOT_COLLECTED สำหรับวันที่ไม่มี event · NO_BASELINE ถ้าไม่มี baseline)
  const out: CfChecklistBranch[] = branches.map((b) => {
    const hasBaseline = hasBaselineSet.has(b.id);
    const dayMap = byBranch.get(b.id);
    const cells: CfChecklistDayCell[] = Array.from({ length: daysInMonth }, (_, i) => {
      if (!hasBaseline) return { status: "NO_BASELINE", amount: 0 };
      return dayMap?.get(i) ?? { status: "NOT_COLLECTED", amount: 0 };
    });
    return {
      branchId: b.id,
      branchName: b.name,
      hasBaseline,
      cells,
    };
  });

  return {
    year,
    month,
    daysInMonth,
    monthLabel: `${THAI_MONTHS[month - 1]} ${year + 543}`,
    prevYm: shiftYm(year, month, -1),
    nextYm: shiftYm(year, month, 1),
    branches: out,
  };
}
