// RentSpace — bill display extras (server-only helpers for the bill pages).
// Keeps the meter-reading lookup + bank-info shaping in one place so the admin
// detail page and the public tenant page render identical meter/payment blocks.
// Read-only — never writes; pure shaping over what's already stored.
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { toNum } from "@/lib/rentspace/format";
import type { BillPaymentInfo } from "@/components/rentspace/bill-document";

type MeterDetail = { prev: number; curr: number; usage: number; rate: number; amount: number };

/**
 * โหลดเลขมิเตอร์ก่อน→หลัง (ไฟ/น้ำ) ของห้อง+งวดนี้ เพื่อโชว์ใน BillDocument.
 * คืน undefined ถ้าไม่มีมิเตอร์เลย (จะไม่ render บล็อก).
 */
export async function loadBillMeterReadings(
  db: PrismaClient,
  unitId: string,
  period: string,
): Promise<{ electric?: MeterDetail; water?: MeterDetail } | undefined> {
  const rows = await db.rentalMeterReading.findMany({ where: { unitId, period } });
  if (rows.length === 0) return undefined;
  const shape = (r: (typeof rows)[number]): MeterDetail => ({
    prev: toNum(r.prevReading),
    curr: toNum(r.currReading),
    usage: toNum(r.usage),
    rate: toNum(r.ratePerUnit),
    amount: toNum(r.amountThb),
  });
  const elec = rows.find((r) => r.kind === "electric");
  const water = rows.find((r) => r.kind === "water");
  const out: { electric?: MeterDetail; water?: MeterDetail } = {};
  if (elec) out.electric = shape(elec);
  if (water) out.water = shape(water);
  return out.electric || out.water ? out : undefined;
}

/** บัญชีรับเงินบริษัท (ค่าเริ่มต้น) — CEO 2026-07-21 สั่งให้ทุกใบบิลโชว์บัญชี + ย้ำโอนบัญชีนี้ทุกครั้ง.
 *  ใช้เมื่อโครงการยังไม่ได้ตั้งค่าบัญชีในหน้า "ตั้งค่า" (ตั้งใน Settings แล้วจะทับค่านี้). */
const COMPANY_DEFAULT_BANK = {
  bankName: "ไทยพาณิชย์ (SCB)",
  bankAccountNo: "813-409410-7",
  bankAccountHolder: "บริษัท เจพีซิ้งค์ กรุ๊ป จำกัด",
};
/** คำเตือนย้ำให้โอนเข้าบัญชีที่กำหนดเท่านั้น — โชว์ทุกใบบิลเสมอ (เว้นแต่โครงการตั้ง note เอง). */
const PAYMENT_WARNING =
  "กรุณาโอนเข้าบัญชีที่ระบุด้านบนนี้เท่านั้นทุกครั้ง — บริษัทขอสงวนสิทธิ์รับผิดชอบเฉพาะการชำระเงินผ่านบัญชีที่กำหนดข้างต้น";

/** ดึงช่องทางชำระเงินจากโครงการ (อ่านคอลัมน์ที่ join มากับบิลแล้ว) — คืนค่าเสมอ (บัญชีบริษัทเป็นค่าเริ่มต้น). */
export function projectBankInfo(project: {
  bankName?: string | null;
  bankAccountNo?: string | null;
  bankAccountHolder?: string | null;
  promptpayId?: string | null;
  paymentNote?: string | null;
}): BillPaymentInfo | undefined {
  // มีข้อมูลบัญชีของโครงการเอง (bank หรือ พร้อมเพย์) → ใช้ของโครงการ · ไม่มี → ใช้บัญชีบริษัทเป็นค่าเริ่มต้น
  const hasProjectBank = !!(
    project.bankName ||
    project.bankAccountNo ||
    project.bankAccountHolder ||
    project.promptpayId
  );
  const bank: BillPaymentInfo = hasProjectBank
    ? {
        bankName: project.bankName ?? null,
        bankAccountNo: project.bankAccountNo ?? null,
        bankAccountHolder: project.bankAccountHolder ?? null,
        promptpayId: project.promptpayId ?? null,
        paymentNote: null,
      }
    : {
        bankName: COMPANY_DEFAULT_BANK.bankName,
        bankAccountNo: COMPANY_DEFAULT_BANK.bankAccountNo,
        bankAccountHolder: COMPANY_DEFAULT_BANK.bankAccountHolder,
        promptpayId: null,
        paymentNote: null,
      };
  // ย้ำเตือนให้โอนบัญชีนี้ทุกครั้ง — ใช้ note ของโครงการถ้าตั้งไว้ ไม่งั้นใช้ข้อความมาตรฐาน
  bank.paymentNote = project.paymentNote?.trim() || PAYMENT_WARNING;
  return bank; // โชว์ช่องทางชำระเงินทุกใบบิลเสมอ
}
