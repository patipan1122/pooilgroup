// ClawFleet · Checklist grid (สาขา × วัน) query layer — server-only. READ-ONLY.
//
// เมทริกซ์ "สาขา × วัน" ย้อนหลัง N วัน — ต่อสาขา ต่อวัน สรุปสถานะการเก็บเงิน:
//   COLLECTED    = มีรอบปิดแล้ว (CLOSED/LOCKED/ANOMALY_REVIEW) ที่เก็บเงินได้ (cash>0) แต่ยังไม่ฝากธนาคาร
//   DEPOSITED    = เก็บแล้ว + ฝากธนาคารแล้ว (รอบมี depositId)
//   REFILL_ONLY  = วันนั้นมีแต่การเติมตุ๊กตา (refillQty>0) ไม่มีการเก็บเงิน
//   NOT_COLLECTED= ไม่มีรอบ/ไม่มี event ในวันนั้น
//   NO_BASELINE  = สาขายังไม่มีตู้ที่ตั้ง baseline (isFirstBaselineLocked) เลย → ทั้งแถวเทา ⚪
//
// ⚪ NO_BASELINE = TONE.neutral (ไม่ใช่สีแดง) — "ยังไม่ตั้งค่า" ไม่ใช่ "ผิดพลาด".
//
// New query — COPY SQL shape จาก matrix-queries.ts แต่ GROUP BY branch_id (ข้ามทุกสาขา
// ในขอบเขต user) แทน machine_id ของสาขาเดียว. Reuse buildIsoDays + businessType filter.

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

export type CfChecklistBranch = {
  branchId: string;
  branchName: string;
  /** false → ทั้งแถวเป็น NO_BASELINE (สาขายังไม่มีตู้ตั้ง baseline) → เรนเดอร์เทา ⚪ */
  hasBaseline: boolean;
  /** isoDay ("YYYY-MM-DD" เวลาไทย) → สถานะ */
  byDay: Record<string, CfChecklistStatus>;
};

export type CfChecklistGrid = {
  /** ISO days เรียงจากใหม่→เก่า (index 0 = วันล่าสุด) — ตรงกับ matrix */
  isoDays: string[];
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

/** สร้าง array ของ ISO days (เวลาไทย) ย้อนหลัง n วัน จากวันนี้ → ใหม่→เก่า (ตรงกับ matrix-queries) */
function buildIsoDays(n: number): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const out: string[] = [];
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    out.push(fmt.format(new Date(now - i * 86_400_000)));
  }
  return out;
}

/**
 * เมทริกซ์ สาขา × วัน (checklist การเก็บเงิน) ย้อนหลัง N วัน — ทุกสาขาในขอบเขต user.
 * READ-ONLY view → scope ด้วย userBranchIds (viewer/admin = "ALL") + orgId เสมอ.
 * - days: จำนวนวันย้อนหลัง (clamp 1–60)
 * - branchIds: กรองเฉพาะสาขาที่ระบุ (subset ของ scope) ถ้าส่งมา
 */
export async function getCfChecklistGrid(input: {
  days: number;
  branchIds?: string[];
}): Promise<CfChecklistGrid> {
  const session: Session = await requireSession();
  const orgId = session.user.org_id;
  const scope = await userBranchIds(session);
  const days = Math.max(1, Math.min(60, Math.floor(input.days)));
  const isoDays = buildIsoDays(days);

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
  if (branches.length === 0) return { isoDays, branches: [] };

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

  // 3. รวมรายวันต่อสาขา (raw SQL · GROUP BY branch_id, iso_day) — copy shape จาก matrix-queries
  //    - date ตัดเป็น "วันไทย" ด้วย AT TIME ZONE 'Asia/Bangkok'
  //    - cash_cents = เงินเก็บได้รวม/สาขา/วัน (เฉพาะรอบที่ปิดแล้ว)
  //    - refills   = จำนวน event ที่ refill_qty > 0 (มีเติมตุ๊กตา)
  //    - deposits  = จำนวนรอบที่มี deposit_id (ฝากธนาคารแล้ว)
  //    - events    = จำนวน event ทั้งหมด (แยก "ไม่มีข้อมูล" ออกจาก "0 บาท")
  //    join sessions → กรองเฉพาะรอบปิดแล้ว (CLOSED/LOCKED/ANOMALY_REVIEW) เหมือน matrix
  //    ⚠️ cf_collection_events ไม่มี branch_id → สาขามาจาก session (s.branch_id) เท่านั้น
  const since = isoDays[isoDays.length - 1]; // วันเก่าสุดในกรอบ "YYYY-MM-DD"
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
      AND (e.collected_at AT TIME ZONE 'Asia/Bangkok')::date >= ${since}::date
    GROUP BY s.branch_id, iso_day
  `;

  // 4. ประกอบสถานะต่อ (สาขา, วัน)
  const byBranch = new Map<string, Record<string, CfChecklistStatus>>();
  for (const r of rows) {
    const events = toNum(r.events);
    if (events === 0) continue;
    const cashCents = toNum(r.cash_cents);
    const refills = toNum(r.refills);
    const deposits = toNum(r.deposits);

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
      m = {};
      byBranch.set(r.branch_id, m);
    }
    m[r.iso_day] = status;
  }

  // 5. ประกอบ output ต่อสาขา (เติม NOT_COLLECTED สำหรับวันที่ไม่มี event · NO_BASELINE ถ้าไม่มี baseline)
  const out: CfChecklistBranch[] = branches.map((b) => {
    const hasBaseline = hasBaselineSet.has(b.id);
    const dayMap = byBranch.get(b.id) ?? {};
    const byDay: Record<string, CfChecklistStatus> = {};
    for (const iso of isoDays) {
      if (!hasBaseline) {
        // ยังไม่ตั้ง baseline → ทั้งแถวเทา ⚪ (ไม่ประเมิน collected/not)
        byDay[iso] = "NO_BASELINE";
      } else {
        byDay[iso] = dayMap[iso] ?? "NOT_COLLECTED";
      }
    }
    return {
      branchId: b.id,
      branchName: b.name,
      hasBaseline,
      byDay,
    };
  });

  return { isoDays, branches: out };
}
