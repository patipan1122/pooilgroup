// RentSpace — billing engine (server-only). Shared by the monthly cron and
// the manual "ออกบิล" action. Idempotent per (contractId, period); race-safe
// bill numbering via unique-constraint retry (per [[ledgerline-arch-review-86fixes]]).
import { prisma } from "@/lib/prisma";
import { prevPeriod, toNum } from "@/lib/rentspace/format";
import { round2, computeBillTotals } from "@/lib/rentspace/bill-math";
import type { Prisma } from "@/lib/generated/prisma/client";

type Contract = Prisma.RentalContractGetPayload<{ include: { project: true; unit: true } }>;

export type RentScheduleEntry = { fromPeriod: string; amount: number };

// round2 + computeBillTotals ย้ายไป lib/rentspace/bill-math.ts (prisma-free · client
// เรียกร่วมได้) — re-export ตรงนี้เพื่อให้โค้ดเดิมที่ import จาก billing.ts ใช้ได้เหมือนเดิม.
export { round2, computeBillTotals };

/**
 * Meter usage that survives a rollover (…9998→9999→0001) or a physical meter
 * swap. Server-side single source of truth — call this anywhere usage is
 * computed so the meter-board, the action and any reprice agree exactly.
 *
 * - normal: usage = max(0, curr − prev)
 * - reset/replaced: the OLD meter ran prev→oldMeterFinal, the NEW meter ran
 *   0→curr, so usage = max(0, oldMeterFinal − prev) + max(0, curr).
 *
 * Everything is clamped at 0 so a mis-keyed reading can never produce a
 * negative (money-eating) line.
 */
export function computeMeterUsage(args: {
  prevReading: number;
  currReading: number;
  isReset: boolean;
  oldMeterFinal?: number | null;
}): number {
  const prev = Number.isFinite(args.prevReading) ? args.prevReading : 0;
  const curr = Number.isFinite(args.currReading) ? args.currReading : 0;
  if (args.isReset) {
    const oldFinal = args.oldMeterFinal != null && Number.isFinite(args.oldMeterFinal) ? args.oldMeterFinal : 0;
    return Math.max(0, oldFinal - prev) + Math.max(0, curr);
  }
  return Math.max(0, curr - prev);
}

/**
 * Per-line VAT default (commercial-plaza convention):
 *   rent → VATable when the contract charges VAT; utilities & fees are
 *   pass-through (not VATable). Centralised so create + recompute never drift.
 */
export function defaultVatable(kind: string, vatPercent: number): boolean {
  return kind === "rent" ? vatPercent > 0 : false;
}

/**
 * รายการไหน "คิด VAT" — ตั้งค่าได้ต่อโครงการ (ค่าเริ่มต้น) + แก้ทับรายห้องได้ในสัญญา.
 * ค่าเช่าอสังหาฯ ยกเว้น VAT ตามปกติ · น้ำ/ไฟ ที่เรียกเก็บถือเป็นบริการ = คิด VAT ได้.
 * VAT เป็น 0 = ไม่คิดทุกรายการ. รวมศูนย์จุดเดียว create/แก้บิลไม่หลุดจาก config.
 */
export function vatableFor(
  kind: string,
  vatPercent: number,
  cfg: { rent: boolean; electric: boolean; water: boolean },
): boolean {
  if (!(vatPercent > 0)) return false;
  if (kind === "rent") return cfg.rent;
  if (kind === "electric") return cfg.electric;
  if (kind === "water") return cfg.water;
  return false; // ค่าปรับล่าช้า / pass-through อื่น ๆ ไม่คิด VAT
}

/** รวม config VAT รายรายการ: สัญญา (override รายห้อง) → โครงการ (ค่าเริ่มต้น). */
export function vatableConfig(contract: Contract): {
  rent: boolean;
  electric: boolean;
  water: boolean;
} {
  return {
    rent: contract.vatOnRent ?? contract.project.vatOnRent,
    electric: contract.vatOnElectric ?? contract.project.vatOnElectric,
    water: contract.vatOnWater ?? contract.project.vatOnWater,
  };
}

/** จำนวนเดือนระหว่างสองงวด YYYY-MM (p2 − p1) — ติดลบถ้า p2 ก่อน p1 */
export function monthsBetween(p1: string, p2: string): number {
  const [y1, m1] = p1.split("-").map(Number);
  const [y2, m2] = p2.split("-").map(Number);
  if (!y1 || !y2) return 0;
  return (y2 - y1) * 12 + (m2 - m1);
}

/**
 * ส่วนลดส่งเสริมการขาย (โปรโมชั่น) ที่ใช้กับงวดนี้ — ลดต่อเดือนคงที่ × จำนวนเดือน
 * เริ่มจาก promoStartPeriod (หรือเดือนเริ่มสัญญาถ้าไม่ระบุ). คืน 0 ถ้าหมดโปรฯ/ยังไม่ถึง/ไม่มี.
 * เป็นส่วนลด "อนุมัติอัตโนมัติ" (ตั้งในสัญญา) ไม่ต้องผ่าน workflow.
 */
export function promoDiscountFor(contract: Contract, period: string): number {
  const per = toNum((contract as { promoDiscountThb?: unknown }).promoDiscountThb);
  const months = Number((contract as { promoMonths?: unknown }).promoMonths) || 0;
  if (per <= 0 || months <= 0) return 0;
  const start =
    (contract as { promoStartPeriod?: string | null }).promoStartPeriod ||
    periodOf(new Date(contract.startDate));
  const idx = monthsBetween(start, period);
  if (idx < 0 || idx >= months) return 0;
  return round2(per);
}

/** สถานะส่วนลดโปรฯ ณ งวดอ้างอิง — ใช้แสดงในตารางห้อง ("฿X เหลือ N เดือน") */
export function promoStatus(
  contract: { promoDiscountThb?: unknown; promoMonths?: unknown; promoStartPeriod?: string | null; startDate: Date | string },
  refPeriod: string,
): { perMonth: number; totalMonths: number; monthsLeft: number; active: boolean } {
  const perMonth = toNum(contract.promoDiscountThb);
  const totalMonths = Number(contract.promoMonths) || 0;
  if (perMonth <= 0 || totalMonths <= 0) return { perMonth: 0, totalMonths: 0, monthsLeft: 0, active: false };
  const start = contract.promoStartPeriod || periodOf(new Date(contract.startDate));
  const idx = monthsBetween(start, refPeriod);
  const used = Math.max(0, Math.min(idx, totalMonths));
  const monthsLeft = Math.max(0, totalMonths - used);
  return { perMonth, totalMonths, monthsLeft, active: idx >= 0 && idx < totalMonths };
}

/** effective monthly rent for a period, honouring rentSchedule escalation */
export function effectiveRent(contract: Contract, period: string): number {
  const base = toNum(contract.rentAmountThb);
  const sched = contract.rentSchedule as unknown as RentScheduleEntry[] | null;
  if (!Array.isArray(sched) || sched.length === 0) return base;
  const applicable = sched
    .filter((e) => e && e.fromPeriod && e.fromPeriod <= period)
    .sort((a, b) => (a.fromPeriod < b.fromPeriod ? -1 : 1));
  return applicable.length ? toNum(applicable[applicable.length - 1].amount) : base;
}

/** INV{YYYYMM}{seq6} — unique per org. Computes next seq from existing bills. */
async function nextBillNo(orgId: string, period: string): Promise<string> {
  const prefix = `INV${period.replace("-", "")}`;
  const last = await prisma.rentalBill.findFirst({
    where: { orgId, billNo: { startsWith: prefix } },
    orderBy: { billNo: "desc" },
    select: { billNo: true },
  });
  const lastSeq = last ? Number(last.billNo.slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(6, "0")}`;
}

/** TX{YYYY}{seq6} — unique per org, resets each calendar year (issuance date, not billing period). */
async function nextTaxInvoiceNo(orgId: string, year: number): Promise<string> {
  const prefix = `TX${year}`;
  const last = await prisma.rentalBill.findFirst({
    where: { orgId, taxInvoiceNo: { startsWith: prefix } },
    orderBy: { taxInvoiceNo: "desc" },
    select: { taxInvoiceNo: true },
  });
  const lastSeq = last?.taxInvoiceNo ? Number(last.taxInvoiceNo.slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(6, "0")}`;
}

/**
 * ออกเลขที่ใบกำกับภาษีให้บิลที่ "จ่ายครบ" แล้ว — idempotent (กดซ้ำคืนเลขเดิม ไม่ออกใหม่)
 * และ race-safe เหมือน nextBillNo: ถ้าสองคำขอชนกัน (บิลเดียวกัน หรือ เลขชนกันคนละบิล)
 * ผู้แพ้จะไม่ได้เลขซ้ำ/เลขหาย — อ่านเลขที่ชนะกลับไปแทน. เลขที่ที่ออกแล้วห้ามเปลี่ยน/ลบ
 * (ดู guard ใน actEditBillItems/actDeleteBill).
 */
export async function issueTaxInvoice(
  billId: string,
  actorId: string | null,
): Promise<{ taxInvoiceNo: string; issuedAt: Date; alreadyIssued: boolean }> {
  const existing = await prisma.rentalBill.findUnique({
    where: { id: billId },
    select: { orgId: true, status: true, taxInvoiceNo: true, taxInvoiceIssuedAt: true },
  });
  if (!existing) throw new Error("ไม่พบบิล");
  if (existing.taxInvoiceNo) {
    return { taxInvoiceNo: existing.taxInvoiceNo, issuedAt: existing.taxInvoiceIssuedAt!, alreadyIssued: true };
  }
  if (existing.status !== "paid") throw new Error("ออกใบกำกับภาษีได้เฉพาะบิลที่จ่ายครบแล้วเท่านั้น");

  // วันที่พิมพ์บนใบกำกับ = วันที่จ่ายงวดล่าสุด (ที่ยืนยันแล้ว) ของบิลนี้ — ไม่ใช่วันที่กดปุ่ม
  const lastPayment = await prisma.rentalPayment.aggregate({
    where: { billId, status: "confirmed" },
    _max: { paidOn: true },
  });
  const taxInvoiceDate = lastPayment._max.paidOn ?? new Date(); // ไม่ควรเกิด (บิลจ่ายครบต้องมีรายการจ่าย) แต่กันพังไว้

  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 5; attempt++) {
    const taxInvoiceNo = await nextTaxInvoiceNo(existing.orgId, year);
    const issuedAt = new Date();
    try {
      // updateMany + where taxInvoiceNo:null = compare-and-swap กันสองคำขอออกเลขให้บิลเดียวกันพร้อมกัน
      const result = await prisma.rentalBill.updateMany({
        where: { id: billId, taxInvoiceNo: null },
        data: { taxInvoiceNo, taxInvoiceIssuedAt: issuedAt, taxInvoiceIssuedBy: actorId, taxInvoiceDate },
      });
      if (result.count === 0) {
        // แพ้ race ให้อีกคำขอ (บิลนี้มีเลขแล้ว) → คืนเลขจริงกลับไป ไม่ throw
        const row = await prisma.rentalBill.findUnique({
          where: { id: billId },
          select: { taxInvoiceNo: true, taxInvoiceIssuedAt: true },
        });
        if (row?.taxInvoiceNo) return { taxInvoiceNo: row.taxInvoiceNo, issuedAt: row.taxInvoiceIssuedAt!, alreadyIssued: true };
        throw new Error("ออกใบกำกับภาษีไม่สำเร็จ กรุณาลองใหม่");
      }
      return { taxInvoiceNo, issuedAt, alreadyIssued: false };
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === "P2002") continue; // เลขชนกับบิลอื่น (คนละแถว) → สุ่มเลขใหม่รอบถัดไป
      throw e;
    }
  }
  throw new Error("ออกเลขที่ใบกำกับภาษีไม่สำเร็จ — เลขชนกันหลายครั้ง");
}

function dueDateFor(period: string, dueDay: number): Date {
  const [y, m] = period.split("-").map(Number);
  const day = Math.min(Math.max(dueDay || 5, 1), 28);
  return new Date(Date.UTC(y, m - 1, day));
}

function issueDateFor(period: string, issueDay?: number | null): Date {
  const [y, m] = period.split("-").map(Number);
  const day = Math.min(Math.max(issueDay || 1, 1), 28);
  return new Date(Date.UTC(y, m - 1, day));
}

export type BuiltBill = {
  rentAmount: number;
  electricAmount: number;
  waterAmount: number;
  lateFeeAmount: number;
  /** ผลรวมรายการประจำอื่น ๆ (ภาษีที่ดิน · ค่าส่วนกลาง · ค่าขยะ · custom ฯลฯ) ที่ไม่เข้าคอลัมน์ rent/ไฟ/น้ำ/ค่าปรับ */
  otherAmount: number;
  items: { kind: string; label: string; qty: number; unitPrice: number; amount: number; vatable: boolean; sort: number }[];
  notes: string[];
};

/** kinds ที่มีคอลัมน์ denormalized เฉพาะตัว (+ discount ที่ไม่ใช่ค่าใช้จ่าย) — ที่เหลือ fold เข้า otherAmount */
const DEDICATED_BILL_KINDS = new Set(["rent", "electric", "water", "late_fee", "discount"]);

/** Days in the calendar month of a YYYY-MM period. */
function daysInPeriod(period: string): number {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of this month
}

/** YYYY-MM of a Date (UTC — startDate is stored as @db.Date). */
function periodOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Compute amounts + line items for one contract+period (reads meters + prior bill). */
export async function buildBill(contract: Contract, period: string): Promise<BuiltBill> {
  const notes: string[] = [];
  const items: BuiltBill["items"] = [];
  const vatPercent = toNum(contract.vatPercent);
  // config VAT รายรายการ (โครงการ + override รายห้อง) — ตัดสินว่า item ไหนคิด VAT
  const vcfg = vatableConfig(contract);

  // 1) rent — prorate the FIRST month by move-in date (เข้าอยู่กลางเดือน คิดตามวันจริง)
  const fullRent = effectiveRent(contract, period);
  const moveInPeriod = periodOf(new Date(contract.startDate));
  const startDay = new Date(contract.startDate).getUTCDate();
  let rentAmount = fullRent;
  let rentLabel = "ค่าเช่า";
  // F1: งวดก่อน "เดือนเริ่มสัญญา" ไม่คิดค่าเช่า (กันออกบิลค่าเช่าเต็มเดือนก่อนสัญญาเริ่มจริง)
  if (period < moveInPeriod) {
    rentAmount = 0;
    rentLabel = "ค่าเช่า (งวดก่อนเริ่มสัญญา — ไม่คิด)";
    notes.push("งวดนี้อยู่ก่อนวันเริ่มสัญญา จึงไม่คิดค่าเช่า");
  } else if (period === moveInPeriod && startDay > 1) {
    const dim = daysInPeriod(period);
    const daysOccupied = dim - startDay + 1;
    rentAmount = round2((fullRent * daysOccupied) / dim);
    const [, mm] = period.split("-");
    rentLabel = `ค่าเช่า (เข้าอยู่ ${startDay}/${mm} · ${daysOccupied}/${dim} วัน)`;
    notes.push(`เดือนแรกคิดค่าเช่าตามวันเข้าอยู่ (${daysOccupied}/${dim} วัน)`);
  }
  items.push({
    kind: "rent",
    label: rentLabel,
    qty: 1,
    unitPrice: rentAmount,
    amount: rentAmount,
    vatable: vatableFor("rent", vatPercent, vcfg),
    sort: 1,
  });

  // 2) electric + water from meter readings of this period
  const readings = await prisma.rentalMeterReading.findMany({
    where: { unitId: contract.unitId, period },
  });
  const elec = readings.find((r) => r.kind === "electric");
  const water = readings.find((r) => r.kind === "water");
  const electricAmount = elec ? toNum(elec.amountThb) : 0;
  const waterAmount = water ? toNum(water.amountThb) : 0;
  if (elec) {
    items.push({
      kind: "electric",
      label: `ค่าไฟ ${toNum(elec.usage)} หน่วย × ${toNum(elec.ratePerUnit)}`,
      qty: toNum(elec.usage),
      unitPrice: toNum(elec.ratePerUnit),
      amount: electricAmount,
      vatable: vatableFor("electric", vatPercent, vcfg),
      sort: 2,
    });
  } else notes.push("ยังไม่ได้จดมิเตอร์ไฟเดือนนี้");
  if (water) {
    items.push({
      kind: "water",
      label: `ค่าน้ำ ${toNum(water.usage)} หน่วย × ${toNum(water.ratePerUnit)}`,
      qty: toNum(water.usage),
      unitPrice: toNum(water.ratePerUnit),
      amount: waterAmount,
      vatable: vatableFor("water", vatPercent, vcfg),
      sort: 3,
    });
  } else notes.push("ยังไม่ได้จดมิเตอร์น้ำเดือนนี้");

  // 3) late fee from prior unpaid bill
  let lateFeeAmount = 0;
  const prior = await prisma.rentalBill.findFirst({
    where: {
      contractId: contract.id,
      period: prevPeriod(period),
      status: { in: ["issued", "partial", "overdue"] },
    },
  });
  if (prior) {
    const outstanding = toNum(prior.totalAmount) - toNum(prior.paidAmount);
    if (outstanding > 0 && contract.lateFeeType !== "none") {
      if (contract.lateFeeType === "fixed") lateFeeAmount = toNum(contract.lateFeeValue);
      else if (contract.lateFeeType === "percent_total")
        lateFeeAmount = Math.round(outstanding * (toNum(contract.lateFeeValue) / 100) * 100) / 100;
      else if (contract.lateFeeType === "per_day") {
        const grace = Math.max(0, contract.lateFeeGraceDays || 0);
        const days = Math.max(
          0,
          Math.floor((Date.now() - new Date(prior.dueDate).getTime()) / 86400000) - grace,
        );
        const capped = Math.min(days, 60);
        lateFeeAmount = capped * toNum(contract.lateFeeValue);
      }
      if (lateFeeAmount > 0) {
        items.push({
          kind: "late_fee",
          label: `ค่าปรับล่าช้า (บิลค้าง ${prevPeriod(period)})`,
          qty: 1,
          unitPrice: lateFeeAmount,
          amount: lateFeeAmount,
          vatable: defaultVatable("late_fee", vatPercent),
          sort: 4,
        });
        notes.push(`มีบิลค้างจ่าย ${prevPeriod(period)} → คิดค่าปรับ`);
      }
    }
  }

  // 4) ค่าใช้จ่ายประจำที่ตั้งไว้ (RentalRecurringCharge) — ค่าส่วนกลาง · ค่าขยะ ·
  //    ภาษีที่ดิน ฯลฯ ที่เก็บทุกเดือน. ดึงเฉพาะที่ isActive และใช้กับห้องนี้:
  //    unitId=null = ใช้ทั้งโครงการ · unitId=ตรงห้องนี้ = เฉพาะห้องนี้.
  //
  //    VAT: เคารพ `vatable` ราย item — ภาษีที่ดิน (land_tax, vatable=false) เป็น
  //    ภาษีส่งผ่าน (pass-through) ห้ามเอาเข้าฐาน VAT. computeBillTotals คิด VAT
  //    จาก items.filter(it => it.vatable) เท่านั้น → ตั้ง vatable ของ item ตาม
  //    charge.vatable ก็พอ ฐาน VAT จะไม่รวม land_tax โดยอัตโนมัติ.
  //
  //    IDEMPOTENCY: buildBill ถูกเรียกจาก createBillForContract เท่านั้น และ
  //    createBillForContract early-return เมื่อมีบิลของ (contractId, period) อยู่แล้ว
  //    (กัน double ด้วย @@unique([contractId, period]) + retry บน P2002) — cron ก็
  //    เรียกผ่าน createBillForContract ตัวเดียวกัน. ดังนั้น buildBill จะ "สร้าง
  //    item ตั้งต้น" ครั้งเดียวต่อบิล รันซ้ำไม่ได้ → recurring item ไม่มีทาง
  //    ซ้ำซ้อน. (การแก้บิลภายหลังใช้ actEditBillItems → recomputeBillTotals
  //    ซึ่งจัดการ item แยกต่างหาก ไม่เรียก buildBill ซ้ำ.)
  //    ขอบเขต: contractId=สัญญานี้ (per-contract · กรอกแยกทุกสัญญา) · หรือ contractId=null
  //    ที่เป็น project-wide (unitId=null) / per-unit ห้องนี้ (legacy · ยังใช้ได้)
  const recurring = await prisma.rentalRecurringCharge.findMany({
    where: {
      orgId: contract.orgId, // F8 defense-in-depth: กันข้อมูลข้าม org แม้ projectId จะผูกกับ org อยู่แล้ว
      projectId: contract.projectId,
      isActive: true,
      OR: [
        { contractId: contract.id },
        { contractId: null, unitId: null },
        { contractId: null, unitId: contract.unitId },
      ],
    },
    orderBy: { sort: "asc" },
  });
  let recurSort = 5;
  for (const charge of recurring) {
    const amount = round2(toNum(charge.amountThb));
    if (amount === 0) continue;
    items.push({
      kind: charge.kind,
      label: charge.label,
      qty: 1,
      unitPrice: amount,
      amount,
      // เคารพ vatable ราย item — land_tax (vatable=false) ไม่เข้าฐาน VAT
      vatable: !!charge.vatable,
      sort: recurSort++,
    });
  }

  // otherAmount = ผลรวมรายการที่ไม่เข้าคอลัมน์ rent/ไฟ/น้ำ/ค่าปรับ (ภาษีที่ดิน · ส่วนกลาง · custom ฯลฯ)
  // → คอลัมน์ denormalized ครบ ไม่หล่นหาย (ยอดรวมจริงคิดจาก items ผ่าน computeBillTotals อยู่แล้ว)
  const otherAmount = round2(
    items.filter((it) => !DEDICATED_BILL_KINDS.has(it.kind)).reduce((s, it) => s + it.amount, 0),
  );

  return { rentAmount, electricAmount, waterAmount, lateFeeAmount, otherAmount, items, notes };
}

/**
 * Recompute subtotal/vat/total/status from items + approved discounts + payments.
 * รับ `db` (tx client) ได้ → เรียกภายใน prisma.$transaction เดียวกับ create/increment payment
 * เพื่อให้ atomic (กัน Σpayments ≠ paidAmount เมื่อ process ตายกลางทาง · A1/A2).
 */
export async function recomputeBillTotals(
  billId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  const bill = await db.rentalBill.findUnique({
    where: { id: billId },
    include: { discounts: true, items: true },
  });
  if (!bill) return;
  // discount can never exceed the gross (no negative bills)
  const rawDiscount = bill.discounts
    .filter((d) => d.status === "approved")
    .reduce((s, d) => s + toNum(d.computedAmount), 0);
  // ใช้อัตรา VAT ที่ "แช่แข็ง" ไว้บนบิล (snapshot ตอนออกบิล) — ไม่อ่านสดจากสัญญา
  // เพื่อไม่ให้บิล/ใบกำกับภาษีที่ออกไปแล้วเปลี่ยนยอดเมื่อแก้ vatPercent ในสัญญาย้อนหลัง (P0-1)
  const vatPercent = toNum(bill.vatPercent);
  const { discountAmount, subtotal, vatAmount, totalAmount } = computeBillTotals({
    items: bill.items.map((it) => ({ amount: toNum(it.amount), vatable: it.vatable })),
    approvedDiscount: rawDiscount,
    vatPercent,
  });
  const paid = toNum(bill.paidAmount);
  let status = bill.status;
  if (bill.status !== "void" && bill.status !== "draft") {
    if (paid >= totalAmount) status = "paid"; // includes fully-discounted ฿0 bills
    // เลยกำหนดชำระ = ค้าง แม้จ่ายมาบางส่วน (ให้โผล่ในหน้าตามเก็บ)
    else if (new Date(bill.dueDate).getTime() < Date.now()) status = "overdue";
    else if (paid > 0) status = "partial";
    else status = "issued";
  }
  await db.rentalBill.update({
    where: { id: billId },
    data: { discountAmount, subtotal, vatAmount, totalAmount, status },
  });
}

/**
 * Create (or return existing) a bill for one contract+period. Idempotent via
 * @@unique([contractId, period]); race-safe billNo via retry on P2002.
 */
export async function createBillForContract(
  contract: Contract,
  period: string,
  opts: { actorId?: string | null; auto?: boolean; issue?: boolean } = {},
): Promise<{ created: boolean; billId: string }> {
  const existing = await prisma.rentalBill.findUnique({
    where: { contractId_period: { contractId: contract.id, period } },
    select: { id: true, status: true, paidAmount: true },
  });
  // มีบิลที่ยัง "ไม่ถูกยกเลิก" ในงวดนี้แล้ว → คืนใบเดิม (idempotent · กันออกซ้ำ)
  if (existing && existing.status !== "void") return { created: false, billId: existing.id };
  // บิลงวดนี้ถูกยกเลิก (void) แต่แถวยังกิน @@unique([contractId, period]) อยู่ →
  // ลบใบที่ยกเลิกทิ้งเพื่อ "ออกบิลงวดเดิมใหม่" ได้ (bug: เดิม early-return ใบ void เลยออกใหม่ไม่ได้)
  // กันเงินหาย: ถ้าใบที่ยกเลิกยังมีประวัติการชำระ ไม่ลบเงียบ ๆ — ให้ผู้ใช้จัดการใบเดิมก่อน
  if (existing && existing.status === "void") {
    if (toNum(existing.paidAmount) > 0)
      throw new Error("บิลงวดนี้ถูกยกเลิกแต่ยังมีประวัติการชำระเงินอยู่ — กรุณาลบบิลเดิมก่อนออกบิลใหม่");
    await prisma.$transaction([
      prisma.rentalDiscount.deleteMany({ where: { billId: existing.id } }),
      prisma.rentalPayment.deleteMany({ where: { billId: existing.id } }),
      prisma.rentalBillItem.deleteMany({ where: { billId: existing.id } }),
      // deleteMany (ไม่ throw ถ้าแถวหายไปแล้วจาก request คู่ขนาน) → race-safe
      prisma.rentalBill.deleteMany({ where: { id: existing.id, status: "void" } }),
    ]);
  }

  const built = await buildBill(contract, period);
  const vatPercent = toNum(contract.vatPercent);
  // ส่วนลดโปรฯ อนุมัติอัตโนมัติจากสัญญา (ถ้ามีและยังอยู่ในช่วงโปรฯ)
  const promo = promoDiscountFor(contract, period);
  // initial totals: include any auto promo discount. Uses the SAME engine as
  // recomputeBillTotals so a fresh bill == a recomputed one.
  const { subtotal, vatAmount, totalAmount, discountAmount } = computeBillTotals({
    items: built.items.map((it) => ({ amount: it.amount, vatable: it.vatable })),
    approvedDiscount: promo,
    vatPercent,
  });
  const status = opts.issue === false ? "draft" : "issued";

  for (let attempt = 0; attempt < 5; attempt++) {
    const billNo = await nextBillNo(contract.orgId, period);
    try {
      const bill = await prisma.rentalBill.create({
        data: {
          orgId: contract.orgId,
          projectId: contract.projectId,
          unitId: contract.unitId,
          contractId: contract.id,
          tenantId: contract.tenantId,
          billNo,
          period,
          issueDate: issueDateFor(period, (contract as { billIssueDay?: number | null }).billIssueDay),
          dueDate: dueDateFor(period, contract.rentDueDay),
          status,
          rentAmount: built.rentAmount,
          electricAmount: built.electricAmount,
          waterAmount: built.waterAmount,
          lateFeeAmount: built.lateFeeAmount,
          otherAmount: built.otherAmount,
          discountAmount,
          subtotal,
          vatAmount,
          vatPercent, // แช่แข็งอัตรา VAT ณ ตอนออกบิล (P0-1)
          totalAmount,
          note: built.notes.join(" · ") || null,
          autoGenerated: !!opts.auto,
          createdBy: opts.actorId ?? null,
          items: { create: built.items },
        },
      });
      // บันทึกส่วนลดโปรฯ เป็น record อนุมัติแล้ว เพื่อให้ recompute ภายหลังตรงกัน
      if (promo > 0) {
        await prisma.rentalDiscount.create({
          data: {
            orgId: contract.orgId,
            billId: bill.id,
            kind: "amount",
            value: promo,
            computedAmount: promo,
            reason: "ส่วนลดโปรโมชั่น (อัตโนมัติจากสัญญา)",
            status: "approved",
            decidedBy: opts.actorId ?? null,
            decidedAt: new Date(),
          },
        });
      }
      return { created: true, billId: bill.id };
    } catch (e: unknown) {
      const code = (e as { code?: string })?.code;
      if (code === "P2002") {
        const msg = String((e as { message?: string })?.message ?? "");
        // contract+period clash → another worker created it; return that one
        if (msg.includes("contract_id") || msg.includes("contractId")) {
          const row = await prisma.rentalBill.findUnique({
            where: { contractId_period: { contractId: contract.id, period } },
            select: { id: true },
          });
          if (row) return { created: false, billId: row.id };
        }
        // billNo clash → retry with a fresh sequence
        continue;
      }
      throw e;
    }
  }
  throw new Error("ออกบิลไม่สำเร็จ — เลขบิลชนกันหลายครั้ง");
}
