// ClawFleet · Matrix (รายงานเจาะสาขา) query layer — server-only.
//
// เมทริกซ์ "ตู้ × วัน" สำหรับสาขาเดียว: ต่อตู้ ต่อวันย้อนหลัง N วัน รวมจาก
// cf_collection_events (เฉพาะ COLLECTION ในรอบที่ปิดแล้ว) →
//   cash   = เงินที่เก็บได้/วัน (บาท)               = SUM(cash_counted_cents)/100
//   dolls  = ตุ๊กตาที่ออก/วัน (ตัว)                  = SUM(doll_meter_after − doll_meter_before)
//   cost   = ต้นทุน/ตัวเฉลี่ย/วัน (บาท)              = cash / dolls (avg บาท/ตุ๊กตา · = ตัวชี้วัด P&L)
//   swapped= มีการเปลี่ยนตุ๊กตา (refill) ในวันนั้น
//
// "ต้นทุน/ตัว" ในเมทริกซ์ = "บาทต่อตุ๊กตา 1 ตัว" (revenue/dolls) — ตัวชี้วัดเดียวกับ pnl-queries
// (band 180–280 = กำลังดี). ไม่ใช่ต้นทุนของจาก loadout.

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { requireSession, type Session } from "@/lib/auth/session";
import { userBranchIds } from "./role-guard";

// raw IN-list ของ uuid (parameterized · กัน SQL injection) — ใช้ Prisma.join
function prismaInUuid(ids: string[]): Prisma.Sql {
  return Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`));
}

/** ค่ารายวันต่อตู้ที่ดึงจาก DB (วัน = key ISO "YYYY-MM-DD" ตามเวลาไทย) */
export type MatrixDayCell = {
  /** ISO day ตามเวลาไทย "YYYY-MM-DD" */
  isoDay: string;
  /** เงินเก็บได้รวม/วัน (บาท) */
  cash: number;
  /** ตุ๊กตาออกรวม/วัน (ตัว) */
  dolls: number;
  /** บาท/ตุ๊กตา 1 ตัว (null ถ้าไม่มีตุ๊กตาออก) */
  cost: number | null;
  /** มี refill (เปลี่ยนตุ๊กตา) ในวันนั้นไหม */
  swapped: boolean;
  /** มี event จริงในวันนั้นไหม (แยก "ไม่มีข้อมูล" ออกจาก "0 บาท") */
  hasData: boolean;
};

export type MatrixMachine = {
  machineId: string;
  code: string;
  nickname: string | null;
  /** map isoDay → ค่ารายวัน (เฉพาะวันที่มี event) */
  byDay: Map<string, MatrixDayCell>;
};

export type MatrixData = {
  branch: { id: string; name: string; code: string } | null;
  /** ISO days เรียงจากใหม่→เก่า (index 0 = วันล่าสุด) ครอบ N วัน */
  isoDays: string[];
  machines: MatrixMachine[];
};

/** raw row จาก groupBy ตู้×วัน */
type RawRow = {
  machine_id: string;
  iso_day: string;
  cash_cents: bigint | number | null;
  dolls: bigint | number | null;
  swaps: bigint | number | null;
  events: bigint | number | null;
};

async function scope(session: Session): Promise<{ orgId: string; branchIds: string[] | "ALL" }> {
  const bs = await userBranchIds(session);
  return { orgId: session.user.org_id, branchIds: bs };
}

function toNum(v: bigint | number | null): number {
  if (v == null) return 0;
  return typeof v === "bigint" ? Number(v) : v;
}

/** สร้าง array ของ ISO days (เวลาไทย) ย้อนหลัง n วัน จากวันนี้ → ใหม่→เก่า */
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
 * เมทริกซ์ ตู้ × วัน ของ "สาขาเดียว" ย้อนหลัง N วัน.
 * - branchCode optional: ถ้าไม่ส่ง → ใช้สาขาแรก (เรียงตาม code) ในขอบเขตของ user
 * - days: จำนวนวันย้อนหลัง (20/30)
 * ทุก query scope ด้วย orgId + branch-scope ของ user.
 */
export async function getMatrixData(
  opts: { branchCode?: string | null; days: number },
): Promise<MatrixData> {
  const session = await requireSession();
  const { orgId, branchIds } = await scope(session);
  const days = Math.max(1, Math.min(60, Math.floor(opts.days)));
  const isoDays = buildIsoDays(days);

  // 1. หา branch เป้าหมาย (ในขอบเขต user · businessType claw_machine)
  const branch = await prisma.branch.findFirst({
    where: {
      orgId,
      businessType: "claw_machine",
      isActive: true,
      ...(opts.branchCode ? { code: opts.branchCode } : {}),
      ...(branchIds === "ALL" ? {} : { id: { in: branchIds } }),
    },
    select: { id: true, name: true, code: true },
    orderBy: { code: "asc" },
  });
  if (!branch) return { branch: null, isoDays, machines: [] };

  // 2. ตู้คีบในสาขา (active)
  const machines = await prisma.cfMachine.findMany({
    where: { orgId, branchId: branch.id, kind: "CLAW", isActive: true },
    select: { id: true, code: true, nickname: true },
    orderBy: { code: "asc" },
  });
  if (machines.length === 0) {
    return { branch: { id: branch.id, name: branch.name, code: branch.code }, isoDays, machines: [] };
  }
  const machineIds = machines.map((m) => m.id);

  // 3. รวมรายวันต่อตู้ (raw SQL · เร็ว · group ที่ DB)
  //    - date ตัดเป็น "วันไทย" ด้วย AT TIME ZONE 'Asia/Bangkok' ก่อน date_trunc
  //    - dolls = SUM(after − before) clamp ≥ 0 ต่อ event (กันมิเตอร์รีเซ็ต)
  //    - swaps = นับ event ที่ refill_qty > 0 (มีเติม/เปลี่ยนตุ๊กตา)
  //    - เฉพาะ event ในรอบที่ปิดแล้ว (CLOSED/LOCKED/ANOMALY_REVIEW)
  const since = isoDays[isoDays.length - 1]; // วันเก่าสุดในกรอบ "YYYY-MM-DD"
  const rows = await prisma.$queryRaw<RawRow[]>`
    SELECT
      e.machine_id::text AS machine_id,
      to_char((e.collected_at AT TIME ZONE 'Asia/Bangkok')::date, 'YYYY-MM-DD') AS iso_day,
      SUM(e.cash_counted_cents)::bigint AS cash_cents,
      SUM(GREATEST(0, COALESCE(e.doll_meter_after, 0) - COALESCE(e.doll_meter_before, 0)))::bigint AS dolls,
      COUNT(*) FILTER (WHERE COALESCE(e.refill_qty, 0) > 0)::bigint AS swaps,
      COUNT(*)::bigint AS events
    FROM cf_collection_events e
    JOIN cf_collection_sessions s ON s.id = e.session_id
    WHERE e.org_id = ${orgId}::uuid
      AND e.machine_id IN (${prismaInUuid(machineIds)})
      AND e.event_type = 'COLLECTION'
      AND s.status IN ('CLOSED', 'LOCKED', 'ANOMALY_REVIEW')
      AND (e.collected_at AT TIME ZONE 'Asia/Bangkok')::date >= ${since}::date
    GROUP BY e.machine_id, iso_day
  `;

  // 4. ประกอบ map ต่อตู้
  const byMachine = new Map<string, Map<string, MatrixDayCell>>();
  for (const r of rows) {
    const cashCents = toNum(r.cash_cents);
    const dolls = toNum(r.dolls);
    const events = toNum(r.events);
    if (events === 0) continue;
    const cash = Math.round(cashCents / 100);
    const cell: MatrixDayCell = {
      isoDay: r.iso_day,
      cash,
      dolls,
      cost: dolls > 0 ? Math.round(cash / dolls) : null,
      swapped: toNum(r.swaps) > 0,
      hasData: true,
    };
    let m = byMachine.get(r.machine_id);
    if (!m) { m = new Map(); byMachine.set(r.machine_id, m); }
    m.set(r.iso_day, cell);
  }

  const out: MatrixMachine[] = machines.map((m) => ({
    machineId: m.id,
    code: m.code,
    nickname: m.nickname,
    byDay: byMachine.get(m.id) ?? new Map<string, MatrixDayCell>(),
  }));

  return {
    branch: { id: branch.id, name: branch.name, code: branch.code },
    isoDays,
    machines: out,
  };
}
