// ClawFleet · Matrix (รายงานเจาะสาขา) query layer — server-only.
//
// เมทริกซ์ "ตู้ × วัน" สำหรับสาขาเดียว: ต่อตู้ ต่อวันย้อนหลัง N วัน รวมจาก
// cf_collection_events (COLLECTION + INITIAL/ตั้งต้น ในรอบที่ปิดแล้ว · D-025) →
//   cash   = รายได้/วัน (บาท) = รอบเก็บจริง + ยอดตั้งต้น = SUM(cash_counted_cents)/100
//            (นับ baseline เป็นรายได้ ให้ตรงกับ ฝากเงิน/hub/P&L — CEO 2026-07-20)
//   dolls  = ตุ๊กตาที่ออก/วัน (ตัว) = SUM(doll_meter Δ) เฉพาะ COLLECTION (ไม่รวมมิเตอร์สะสมตอนตั้งต้น)
//   cost   = บาท/ตุ๊กตา 1 ตัว = (เงินรอบเก็บจริง) / dolls (ไม่รวมยอดตั้งต้น · = ตัวชี้วัด P&L)
//   swapped= มีการเปลี่ยนตุ๊กตา (refill) ในวันนั้น · baseline= มียอดตั้งต้น · anomaly= มีรอบรอตรวจ
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
  /** เงินเก็บได้รวม/วัน (บาท) = รอบเก็บจริง + ยอดตั้งต้น (baseline) · ให้ตรงกับ ฝากเงิน/hub/P&L (D-025) */
  cash: number;
  /** ตุ๊กตาออกรวม/วัน (ตัว) — เฉพาะรอบเก็บจริง ไม่รวมมิเตอร์สะสมตอนตั้งต้น */
  dolls: number;
  /** บาท/ตุ๊กตา 1 ตัว (null ถ้าไม่มีตุ๊กตาออก) — คิดจากเงินรอบเก็บจริงเท่านั้น ไม่รวมยอดตั้งต้น */
  cost: number | null;
  /** มี refill (เปลี่ยนตุ๊กตา) ในวันนั้นไหม */
  swapped: boolean;
  /** วันนี้มี "ยอดตั้งต้น" (ตั้งค่าตู้ครั้งแรก) รวมอยู่ในเงินไหม → ให้ client ติดป้ายแยก */
  baseline: boolean;
  /** มีรอบที่ยัง "รอตรวจ" (ANOMALY_REVIEW) ในวันนั้นไหม → client ติดธงเตือน */
  anomaly: boolean;
  /** CEO 2026-08-06 · ช่องนี้มีธงเตือน "ชนิดใด ๆ" (เงิน/ตุ๊กตา/มิเตอร์/outlier) → รอตรวจ พื้นแดง (ถ้ายังไม่ยืนยัน) · เดิมจำกัดเฉพาะธงเงิน */
  flagged: boolean;
  /** มีธงเตือน + หัวหน้ายืนยันตรวจครบทุกใบแล้ว → พื้นฟ้าอ่อน (ตรวจแล้ว) */
  flagReviewed: boolean;
  /** วันนี้มี "รอบเก็บเงิน" (COLLECTION) ไหม → ใช้ "นับตู้ที่เก็บ" ในคอลัมน์รวม/วัน (ตั้งต้นไม่นับ) */
  collected: boolean;
  /** CEO 2026-08-02 · วันนี้มีแต่ "เติมตุ๊กตานอกรอบเก็บ" ล้วน (ไม่มีเก็บเงิน/ตั้งต้น) → โผล่เป็นช่องพิเศษ 🧸 */
  refillOnly: boolean;
  /** จำนวนตุ๊กตาที่เติม "นอกรอบเก็บ" วันนั้น (รวม) — โชว์ในช่อง refill-only + ป๊อปอัป */
  refillDolls: number;
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
  coll_cash_cents: bigint | number | null;
  dolls: bigint | number | null;
  swaps: bigint | number | null;
  has_baseline: boolean | null;
  has_collection: boolean | null;
  anomaly: boolean | null;
  flagged: boolean | null;
  flag_unreviewed: boolean | null;
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
      SUM(e.cash_counted_cents) FILTER (WHERE e.event_type = 'COLLECTION')::bigint AS coll_cash_cents,
      SUM(GREATEST(0, COALESCE(e.doll_meter_after, 0) - COALESCE(e.doll_meter_before, 0)))
        FILTER (WHERE e.event_type = 'COLLECTION')::bigint AS dolls,
      COUNT(*) FILTER (WHERE COALESCE(e.refill_qty, 0) > 0)::bigint AS swaps,
      bool_or(e.event_type = 'INITIAL') AS has_baseline,
      bool_or(e.event_type = 'COLLECTION') AS has_collection,
      bool_or(s.status = 'ANOMALY_REVIEW') AS anomaly,
      -- CEO 2026-08-06 · ทุกช่องที่ระบบเตือน (ธงผิดปกติชนิดใด ๆ: เงิน/ตุ๊กตา/มิเตอร์/outlier หรือมีเหตุผลเงินขาด)
      --   → รอตรวจ (แดง) · หัวหน้ายืนยันตรวจครบทุกใบ (reviewed_at) → ตรวจแล้ว (ฟ้า) · เดิมจำกัดเฉพาะธงเงิน M2/M3/M4/M6
      bool_or(cardinality(e.anomaly_flags) > 0 OR e.short_reason IS NOT NULL) AS flagged,
      bool_or((cardinality(e.anomaly_flags) > 0 OR e.short_reason IS NOT NULL) AND e.reviewed_at IS NULL) AS flag_unreviewed,
      COUNT(*)::bigint AS events
    FROM cf_collection_events e
    JOIN cf_collection_sessions s ON s.id = e.session_id
    WHERE e.org_id = ${orgId}::uuid
      AND e.machine_id IN (${prismaInUuid(machineIds)})
      AND e.event_type IN ('COLLECTION', 'INITIAL')
      -- + OPEN (กำลังเก็บ) — เงินที่เก็บแล้วเข้ารายงานเจาะสาขาทันที · per-event ไม่ขยับของเก่า (CEO 2026-08-01)
      AND s.status IN ('CLOSED', 'LOCKED', 'ANOMALY_REVIEW', 'OPEN')
      AND (e.collected_at AT TIME ZONE 'Asia/Bangkok')::date >= ${since}::date
    GROUP BY e.machine_id, iso_day
  `;

  // 4. ประกอบ map ต่อตู้
  const byMachine = new Map<string, Map<string, MatrixDayCell>>();
  for (const r of rows) {
    const cashCents = toNum(r.cash_cents); // รวม baseline = รายได้ (ให้ตรงกับ ฝากเงิน/hub/P&L)
    const collCashCents = toNum(r.coll_cash_cents); // เฉพาะรอบเก็บจริง → ใช้คิดต้นทุน/ตัว
    const dolls = toNum(r.dolls); // เฉพาะรอบเก็บจริง (ไม่รวมมิเตอร์ตั้งต้น)
    const events = toNum(r.events);
    if (events === 0) continue;
    const cash = Math.round(cashCents / 100);
    const collCash = Math.round(collCashCents / 100);
    const cell: MatrixDayCell = {
      isoDay: r.iso_day,
      cash,
      dolls,
      // ต้นทุน/ตัว = บาทต่อตุ๊กตา คิดจาก "รอบเก็บจริง" เท่านั้น (ยอดตั้งต้นไม่ได้มาจากการปล่อยตุ๊กตา)
      cost: dolls > 0 ? Math.round(collCash / dolls) : null,
      swapped: toNum(r.swaps) > 0,
      baseline: r.has_baseline === true,
      collected: r.has_collection === true,
      anomaly: r.anomaly === true,
      flagged: r.flagged === true,
      flagReviewed: r.flagged === true && r.flag_unreviewed !== true,
      refillOnly: false,
      refillDolls: 0,
      hasData: true,
    };
    let m = byMachine.get(r.machine_id);
    if (!m) { m = new Map(); byMachine.set(r.machine_id, m); }
    m.set(r.iso_day, cell);
  }

  // 4b. เติมตุ๊กตา "นอกรอบเก็บ" (standalone refill · cf_stock_movements ref_table='cf_refill_dolls')
  //     — ไม่มี event ในตารางเดิม → รายงานเจาะสาขา "มองไม่เห็น". ดึงมา merge (READ-ONLY · ไม่แตะเงิน):
  //       • วันที่มี cell อยู่แล้ว (เก็บเงิน/ตั้งต้น) → ติดธง swapped + สะสมจำนวนเติม
  //       • วันที่ไม่มี event → สร้างช่องใหม่ refillOnly (โผล่ในตาราง · กดดูได้ว่าเติมอะไรเท่าไร)
  type RefillRow = { machine_id: string; iso_day: string; refill_dolls: bigint | number | null };
  const refillRows = await prisma.$queryRaw<RefillRow[]>`
    SELECT
      sm.machine_id::text AS machine_id,
      to_char((sm.occurred_at AT TIME ZONE 'Asia/Bangkok')::date, 'YYYY-MM-DD') AS iso_day,
      SUM(ABS(sm.qty))::bigint AS refill_dolls
    FROM cf_stock_movements sm
    WHERE sm.org_id = ${orgId}::uuid
      AND sm.machine_id IN (${prismaInUuid(machineIds)})
      AND sm.ref_table = 'cf_refill_dolls'
      AND (sm.occurred_at AT TIME ZONE 'Asia/Bangkok')::date >= ${since}::date
    GROUP BY sm.machine_id, iso_day
  `;
  for (const r of refillRows) {
    const qty = toNum(r.refill_dolls);
    if (qty <= 0) continue;
    let m = byMachine.get(r.machine_id);
    if (!m) { m = new Map(); byMachine.set(r.machine_id, m); }
    const existing = m.get(r.iso_day);
    if (existing) {
      existing.swapped = true;           // วันนั้นมีเปลี่ยน/เติมตุ๊กตา
      existing.refillDolls += qty;
    } else {
      m.set(r.iso_day, {
        isoDay: r.iso_day,
        cash: 0, dolls: 0, cost: null,
        swapped: true,
        baseline: false, collected: false, anomaly: false,
        flagged: false, flagReviewed: false,
        refillOnly: true, refillDolls: qty,
        hasData: true,
      });
    }
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
