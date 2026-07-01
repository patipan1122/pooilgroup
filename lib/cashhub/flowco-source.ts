// FlowCo fuel-sales source — reads the auto-synced gas-station tables that live in
// the SAME Supabase DB as the app (public.po_fuel_sales_daily / po_fuel_payment_daily),
// aggregates per (ste_id, business_date), and shapes rows for a DailyReport upsert.
//
// Why raw admin.from() instead of Prisma: these 3 tables are populated by an
// external office-PC sync (daily 08:00) and are NOT modeled in prisma/schema.prisma.
// They ARE in the public schema, so the Supabase service-role client reads them fine
// via PostgREST — and `date` columns come back as clean "YYYY-MM-DD" strings, which
// sidesteps the JS-Date timezone shift we'd hit with node-postgres.
//
// ⚠️ no-silent-cap: PostgREST caps each response at 1000 rows → we paginate with
// .range() until a short page. A 30-day window across ~22 branches × ~6 grades can
// exceed 1000 rows, so this matters.

import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = SupabaseClient;

export interface FlowcoDayAgg {
  steId: number;
  reportDate: string; // YYYY-MM-DD (business_date, as stored)
  liters: number; // Σ sell_q (ลิตรที่ขายจริง, ไม่รวมทดสอบหัวจ่าย)
  testLiters: number; // Σ test_q
  totalSales: number; // Σ sell_a (บาท — ยอดขายจริง)
  gradeCount: number; // จำนวนชนิดน้ำมันที่มียอดในวันนั้น
  cash: number; // group 1
  card: number; // group 2 (บัตรเครดิต) + 8 (ฟลีทการ์ด)
  credit: number; // group 3 (เงินเชื่อ)
  transfer: number; // group 57 (THAI QR) + 58 (โอนเงิน) + 59 (True wallet)
  payOther: number; // group -1 (ส่วนลด/โปร), 4 (คูปอง), 902 (ใช้ภายใน)
  payTotal: number; // Σ วิธีจ่ายทั้งหมด (ไว้ตรวจ reconcile กับ totalSales)
  anomalyCount: number; // จำนวนแถวชนิดน้ำมันที่ถูกกรองออกวันนั้น (ค่าเพี้ยน/มิเตอร์รีเซ็ต)
}

// ค่าที่เป็นไปไม่ได้สำหรับปั๊ม 1 ชนิด/วัน (meter reset / sync glitch) → กรองออก + นับไว้โชว์
export const MAX_GRADE_LITERS = 100_000; // ลิตร/ชนิด/วัน
export const MAX_GRADE_BAHT = 5_000_000; // บาท/ชนิด/วัน
function isAnomalousGrade(q: number, a: number): boolean {
  return q < 0 || a < 0 || q > MAX_GRADE_LITERS || a > MAX_GRADE_BAHT;
}

const PAGE = 1000;

async function fetchAllRows<T>(
  admin: Admin,
  table: string,
  cols: string,
  dateCol: string,
  from: string,
  to: string,
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await admin
      .from(table)
      .select(cols)
      .gte(dateCol, from)
      .lte(dateCol, to)
      .order(dateCol, { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`อ่านตาราง ${table} ไม่สำเร็จ: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return rows;
}

/** วิธีจ่าย (group_code จาก po_fuel_payment_daily) → ช่องใน DailyReport */
export function payBucket(
  groupCode: number,
): "cash" | "card" | "credit" | "transfer" | "payOther" {
  if (groupCode === 1) return "cash";
  if (groupCode === 2 || groupCode === 8) return "card"; // บัตรเครดิต + ฟลีทการ์ด
  if (groupCode === 3) return "credit"; // เงินเชื่อ (ลูกหนี้)
  if (groupCode === 57 || groupCode === 58 || groupCode === 59) return "transfer"; // QR + โอน + wallet
  return "payOther"; // -1 ส่วนลด/โปร, 4 คูปอง, 902 ใช้ภายใน, อื่น ๆ
}

interface SalesRow {
  ste_id: number;
  business_date: string;
  sell_q: number | string | null;
  sell_a: number | string | null;
  test_q: number | string | null;
}
interface PayRow {
  ste_id: number;
  biz_date: string;
  group_code: number;
  amt: number | string | null;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
};

/**
 * รวมยอดขาย + วิธีจ่าย ต่อ (สาขา, วัน) ในช่วงวันที่ [dateFrom, dateTo] (inclusive).
 * dateFrom/dateTo = "YYYY-MM-DD".
 */
export async function fetchFlowcoAggregates(
  admin: Admin,
  dateFrom: string,
  dateTo: string,
): Promise<FlowcoDayAgg[]> {
  const [sales, pays] = await Promise.all([
    fetchAllRows<SalesRow>(
      admin,
      "po_fuel_sales_daily",
      "ste_id,business_date,sell_q,sell_a,test_q",
      "business_date",
      dateFrom,
      dateTo,
    ),
    fetchAllRows<PayRow>(
      admin,
      "po_fuel_payment_daily",
      "ste_id,biz_date,group_code,amt",
      "biz_date",
      dateFrom,
      dateTo,
    ),
  ]);

  const map = new Map<string, FlowcoDayAgg>();
  const keyOf = (ste: number, d: string) => `${ste}__${d}`;
  const bucket = (ste: number, d: string): FlowcoDayAgg => {
    const k = keyOf(ste, d);
    let a = map.get(k);
    if (!a) {
      a = {
        steId: ste,
        reportDate: d,
        liters: 0,
        testLiters: 0,
        totalSales: 0,
        gradeCount: 0,
        cash: 0,
        card: 0,
        credit: 0,
        transfer: 0,
        payOther: 0,
        payTotal: 0,
        anomalyCount: 0,
      };
      map.set(k, a);
    }
    return a;
  };

  for (const r of sales) {
    if (r.ste_id == null || !r.business_date) continue;
    const a = bucket(r.ste_id, r.business_date);
    const q = num(r.sell_q);
    const amt = num(r.sell_a);
    if (isAnomalousGrade(q, amt)) {
      a.anomalyCount += 1; // ค่าเพี้ยน — ไม่รวมเข้ายอด แต่นับไว้โชว์
      continue;
    }
    a.liters += q;
    a.testLiters += num(r.test_q);
    a.totalSales += amt;
    a.gradeCount += 1;
  }

  for (const r of pays) {
    if (r.ste_id == null || !r.biz_date) continue;
    const a = bucket(r.ste_id, r.biz_date);
    const amt = num(r.amt);
    a[payBucket(r.group_code)] += amt;
    a.payTotal += amt;
  }

  return [...map.values()].sort((x, y) =>
    x.reportDate === y.reportDate
      ? x.steId - y.steId
      : x.reportDate < y.reportDate
        ? -1
        : 1,
  );
}

function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

export interface FlowcoShiftRow {
  steId: number;
  reportDate: string; // = biz_date - 1 (align กับ po_fuel_sales_daily.business_date)
  shiftNo: number; // 1=กะเช้า, 2=กะดึก
  baht: number;
  liters: number;
}

/**
 * อ่านยอดขายแยกกะ (po_fuel_shift_sales) สำหรับช่วง report date [dateFrom, dateTo].
 * ⚠️ ตาราง shift ใช้ biz_date เหลื่อม +1 วันจาก sales_daily.business_date (พิสูจน์แล้ว)
 * → ดึง biz_date ในช่วง [from+1, to+1] แล้ว map reportDate = biz_date - 1 ให้ยอดกะรวม = ยอดรายวันเป๊ะ.
 */
export async function fetchFlowcoShiftRows(
  admin: Admin,
  dateFrom: string,
  dateTo: string,
  steId?: number | null,
): Promise<FlowcoShiftRow[]> {
  const bizFrom = addDaysYmd(dateFrom, 1);
  const bizTo = addDaysYmd(dateTo, 1);
  const out: FlowcoShiftRow[] = [];
  let offset = 0;
  for (;;) {
    let query = admin
      .from("po_fuel_shift_sales")
      .select("ste_id,biz_date,shift_no,baht,liters")
      .gte("biz_date", bizFrom)
      .lte("biz_date", bizTo);
    if (steId) query = query.eq("ste_id", steId);
    const { data, error } = await query
      .order("biz_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`อ่านยอดกะไม่สำเร็จ: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as {
      ste_id: number;
      biz_date: string;
      shift_no: number;
      baht: number | string | null;
      liters: number | string | null;
    }[]) {
      const b = num(r.baht);
      const l = num(r.liters);
      if (b < 0 || b > MAX_GRADE_BAHT || l < 0 || l > MAX_GRADE_LITERS) continue; // กันเพี้ยน
      out.push({
        steId: r.ste_id,
        reportDate: addDaysYmd(r.biz_date, -1), // align กับ business_date
        shiftNo: r.shift_no === 2 ? 2 : 1,
        baht: b,
        liters: l,
      });
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

export interface FlowcoGradeRow {
  steId: number;
  reportDate: string; // YYYY-MM-DD
  gradeId: number;
  gradeName: string;
  liters: number;
  sales: number;
}

/** อ่านยอดขายรายชนิดน้ำมัน (สำหรับกดขยายดูแยกประเภทน้ำมัน) — กรองแถวเพี้ยนออกแล้ว */
export async function fetchFlowcoGradeRows(
  admin: Admin,
  dateFrom: string,
  dateTo: string,
  steId?: number | null,
): Promise<FlowcoGradeRow[]> {
  const out: FlowcoGradeRow[] = [];
  let offset = 0;
  for (;;) {
    let query = admin
      .from("po_fuel_sales_daily")
      .select("ste_id,business_date,grade_id,grade_name,sell_q,sell_a")
      .gte("business_date", dateFrom)
      .lte("business_date", dateTo);
    if (steId) query = query.eq("ste_id", steId);
    const { data, error } = await query
      .order("business_date", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`อ่านชนิดน้ำมันไม่สำเร็จ: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data as {
      ste_id: number;
      business_date: string;
      grade_id: number;
      grade_name: string;
      sell_q: number | string | null;
      sell_a: number | string | null;
    }[]) {
      const q = num(r.sell_q);
      const a = num(r.sell_a);
      if (isAnomalousGrade(q, a)) continue; // กรองแถวเพี้ยน
      out.push({
        steId: r.ste_id,
        reportDate: r.business_date,
        gradeId: r.grade_id,
        gradeName: (r.grade_name ?? "").trim() || `เกรด ${r.grade_id}`,
        liters: q,
        sales: a,
      });
    }
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return out;
}

/** รายชื่อ ste_id ที่มีข้อมูลจริง (ไว้เทียบกับลิสต์ 20 สาขา — จับตัวแปลกปลอม 3001/9999) */
export async function fetchFlowcoSteIds(admin: Admin): Promise<number[]> {
  const rows: { ste_id: number }[] = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await admin
      .from("po_fuel_sales_daily")
      .select("ste_id")
      .order("ste_id", { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`อ่าน ste_id ไม่สำเร็จ: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as { ste_id: number }[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return [...new Set(rows.map((r) => r.ste_id).filter((x) => x != null))].sort(
    (a, b) => a - b,
  );
}

/** ช่วงวันที่ที่มีข้อมูล (min/max business_date) ไว้ตั้งค่า default ของ date picker */
export async function fetchFlowcoDateRange(
  admin: Admin,
): Promise<{ min: string | null; max: string | null }> {
  const first = await admin
    .from("po_fuel_sales_daily")
    .select("business_date")
    .order("business_date", { ascending: true })
    .limit(1)
    .maybeSingle();
  const last = await admin
    .from("po_fuel_sales_daily")
    .select("business_date")
    .order("business_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return {
    min: (first.data?.business_date as string) ?? null,
    max: (last.data?.business_date as string) ?? null,
  };
}
