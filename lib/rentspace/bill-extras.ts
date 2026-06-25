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

/** ดึงช่องทางชำระเงินจากโครงการ (อ่านคอลัมน์ที่ join มากับบิลแล้ว). */
export function projectBankInfo(project: {
  bankName?: string | null;
  bankAccountNo?: string | null;
  bankAccountHolder?: string | null;
  promptpayId?: string | null;
  paymentNote?: string | null;
}): BillPaymentInfo | undefined {
  const bank: BillPaymentInfo = {
    bankName: project.bankName ?? null,
    bankAccountNo: project.bankAccountNo ?? null,
    bankAccountHolder: project.bankAccountHolder ?? null,
    promptpayId: project.promptpayId ?? null,
    paymentNote: project.paymentNote ?? null,
  };
  const any = bank.bankName || bank.bankAccountNo || bank.bankAccountHolder || bank.promptpayId || bank.paymentNote;
  return any ? bank : undefined;
}
