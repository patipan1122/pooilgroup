// AI อ่านสลิป + ตรวจสลิปซ้ำ/บัญชีปลายทางผิด สำหรับ RentSpace (2026-08-29)
// เรียกยืม extractSlipDetails ตรงจาก ChairOps (ฟังก์ชันทั่วไป ไม่ผูก type ChairOps)
// แต่เขียน dup-check ของตัวเองเพราะ checkSlipFraud เดิมผูกกับตาราง ChairopsCashDeposit
// ตรง ๆ — RentSpace ใช้ RentalPayment แทน ขอบเขตซ้ำ = "สัญญาเดียวกัน" (เงินตามผู้เช่า
// ไม่ใช่ตามห้อง — ผู้เช่าย้ายห้อง/มี 2 สัญญาไม่ควรชนกัน)
//
// เช็คบัญชีปลายทางเทียบ "เลขบัญชี" ไม่ใช่ "ชื่อบัญชี" — ตาม fix ของ ChairOps
// (commit d3dc8b7a, 2026-08-29): ชื่อนิติบุคคลเต็มที่ AI อ่านจากสลิปเขียนคนละรูปแบบ
// กับชื่อย่อที่ตั้งค่าไว้ในระบบเสมอ ยืนยันจริง 73/73 ใบติดธงเท็จตอนเทียบด้วยชื่อ —
// เลขบัญชีเป็นตัวเลขล้วน AI อ่านแม่นกว่ามาก
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/prisma";
import { adminClient } from "@/lib/db/server";
import { extractSlipDetails, type SlipOcrDetails } from "@/lib/chairops/reconcile/slip-ocr";

export { extractSlipDetails };
export type { SlipOcrDetails };

const TZ = "Asia/Bangkok";

// วันที่ (Date | ISO string) → "YYYY-MM-DD" ตามเขตเวลาไทยเสมอ — กัน bug class ที่เคยเจอ
// (raw ::date / JS Date.toISOString() ตัด UTC ดิบ ผิดช่วงเที่ยงคืน-ตี6 ไทย). paidOn/ocrDate
// เป็นคอลัมน์ Postgres `date` (ไม่มีเวลา) แต่ยัง format ผ่าน Bangkok TZ เสมอเพื่อความชัดเจน
// และเผื่อกรณีในอนาคตมีคอลัมน์ timestamptz เข้ามาแทนที่.
function bkkDateStr(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return null;
  return formatInTimeZone(dt, TZ, "yyyy-MM-dd");
}

// เทียบเฉพาะตัวเลข — ตัด "-", "x", "*", ช่องว่างทิ้ง (บางสลิปปิดบังหลักกลางด้วย x/*).
const normalizeAcctNo = (s: string) => s.replace(/[^0-9]/g, "");

export type RentSpaceSlipFraudCheck = { flagged: boolean; reason: string | null };

export async function checkRentSpaceSlipFraud(args: {
  orgId: string;
  contractId: string;
  paymentId: string;
  ocr: SlipOcrDetails;
  configuredAccountNumber: string | null;
}): Promise<RentSpaceSlipFraudCheck> {
  const { orgId, contractId, paymentId, ocr, configuredAccountNumber } = args;

  if (ocr.refNo) {
    const dupRef = await prisma.rentalPayment.findFirst({
      where: { orgId, contractId, id: { not: paymentId }, ocrRefNo: ocr.refNo },
      select: { id: true },
    });
    if (dupRef) {
      return {
        flagged: true,
        reason: "สลิปนี้มีเลขที่รายการตรงกับรายการจ่ายอื่นของสัญญาเดียวกัน — สงสัยส่งสลิปเดิมซ้ำ กรุณาตรวจสอบ",
      };
    }
  } else if (ocr.amount != null && ocr.date != null) {
    const dup = await prisma.rentalPayment.findFirst({
      where: {
        orgId,
        contractId,
        id: { not: paymentId },
        ocrAmount: ocr.amount,
        ocrDate: new Date(`${ocr.date}T00:00:00.000Z`),
      },
      select: { id: true },
    });
    if (dup) {
      return {
        flagged: true,
        reason: "สลิปนี้วันที่+ยอดตรงกับรายการจ่ายอื่นของสัญญาเดียวกัน — กรุณาตรวจสอบว่าไม่ใช่สลิปเดิมที่ส่งซ้ำ",
      };
    }
  }

  if (configuredAccountNumber && ocr.accountNumber) {
    const a = normalizeAcctNo(configuredAccountNumber);
    const b = normalizeAcctNo(ocr.accountNumber);
    const matches = a.length >= 4 && b.length >= 4 && (a === b || a.endsWith(b) || b.endsWith(a));
    if (!matches) {
      return {
        flagged: true,
        reason: `เลขบัญชีปลายทางบนสลิป ("${ocr.accountNumber}") ดูไม่ตรงกับบัญชีที่ตั้งค่าไว้ ("${configuredAccountNumber}") — กรุณาตรวจสอบว่าเงินเข้าบัญชีถูกต้อง`,
      };
    }
  }

  return { flagged: false, reason: null };
}

async function resolveConfiguredAccountNumber(projectId: string): Promise<string | null> {
  const project = await prisma.rentalProject.findUnique({
    where: { id: projectId },
    select: { reconcileBankAccountId: true },
  });
  if (!project?.reconcileBankAccountId) return null;
  const admin = adminClient();
  const { data: acc } = await admin
    .from("ledger_bank_account")
    .select("account_no")
    .eq("id", project.reconcileBankAccountId)
    .maybeSingle();
  return (acc?.account_no as string | undefined) ?? null;
}

/**
 * รันหลัง payment ถูกสร้าง/commit แล้วเท่านั้น (นอก transaction, best-effort, ไม่ throw)
 * — เรียกจาก actRecordPayment (staff) และ actPortalSubmitSlip (ผู้เช่าอัปโหลดเอง)
 * ทั้งสองทาง ปิดช่องเดียวกันทั้งระบบ (CEO 2026-08-29: "ตรวจทั้งสองทาง")
 */
export async function runRentSpaceSlipCheck(args: {
  orgId: string;
  projectId: string;
  contractId: string;
  paymentId: string;
  slipUrl: string;
  actor: { userId: string; orgId: string };
}): Promise<void> {
  const { orgId, projectId, contractId, paymentId, slipUrl, actor } = args;
  try {
    const ocr = await extractSlipDetails(slipUrl, actor);
    const configuredAccountNumber = await resolveConfiguredAccountNumber(projectId);
    const check = await checkRentSpaceSlipFraud({ orgId, contractId, paymentId, ocr, configuredAccountNumber });
    await prisma.rentalPayment.update({
      where: { id: paymentId },
      data: {
        ocrAmount: ocr.amount,
        ocrDate: ocr.date ? new Date(`${ocr.date}T00:00:00.000Z`) : null,
        ocrAccountName: ocr.accountName,
        ocrAccountNumber: ocr.accountNumber,
        ocrRefNo: ocr.refNo,
        ocrReadAt: new Date(),
        ocrFlagReason: check.reason,
        requiresReview: check.flagged,
      },
    });
  } catch (e) {
    // best-effort เหมือน ChairOps — อ่านสลิปพังต้องไม่ทำให้การรับชำระเงินพัง
    console.error("[rentspace] runRentSpaceSlipCheck failed (non-fatal)", e);
  }
}

// ============================================================================
// CEO 2026-09-09: จุดเขียว/แดงต่อแถวใน popup CellDetail (matrix)
// ต่างจาก requiresReview/ocrFlagReason ด้านบน (เช็ค "สลิปซ้ำ" + "บัญชีผิดตอนบันทึก")
// — อันนี้เช็คว่าสลิปที่ AI อ่านได้ "ตรงกับที่บันทึกไว้เอง" ไหม 2 เรื่อง: (1) วันที่บนสลิป
// ตรงกับ paidOn ที่กรอกไหม (2) เลขบัญชีปลายทางตรงกับบัญชีบริษัทที่ตั้งค่าไว้ไหม
// ไม่ตรงข้อใดข้อหนึ่ง หรือประเมินไม่ได้ (อ่านสลิปไม่ออก / ยังไม่ตั้งค่าบัญชี) = แดง
// ทั้งคู่ผ่าน = เขียว — ไม่แตะสี cell ตาราง/RentalBill.status เดิมเลย (ตัวชี้วัดใหม่แยกกัน)
// ============================================================================

export type RentSpacePaymentMatchVerdict = {
  dateMatch: boolean;
  acctMatch: boolean;
  ok: boolean; // dateMatch && acctMatch
  reason: string | null; // null = ผ่านทั้งคู่ · มีค่า = เหตุผลที่แดง (โชว์ตรงๆ ให้คนตรวจ)
};

/** เทียบ "วันที่บนสลิป" vs "paidOn ที่บันทึก" (Bangkok TZ เสมอ — ห้าม UTC ดิบ) +
 *  "เลขบัญชีปลายทาง" vs บัญชีบริษัทที่ตั้งค่าไว้ (เทียบแบบ suffix เหมือน ChairOps/RentSpace เดิม
 *  เผื่อสลิปปิดบังหลักกลาง — ดู checkRentSpaceSlipFraud ด้านบน) */
export function evaluatePaymentSlipMatch(args: {
  paidOn: Date | string;
  ocr: { date: Date | string | null; accountNumber: string | null };
  configuredAccountNumber: string | null;
}): RentSpacePaymentMatchVerdict {
  const { paidOn, ocr, configuredAccountNumber } = args;

  const paidOnStr = bkkDateStr(paidOn);
  const ocrDateStr = bkkDateStr(ocr.date);
  const dateMatch = !!paidOnStr && !!ocrDateStr && paidOnStr === ocrDateStr;

  let acctMatch = false;
  if (configuredAccountNumber && ocr.accountNumber) {
    const a = normalizeAcctNo(configuredAccountNumber);
    const b = normalizeAcctNo(ocr.accountNumber);
    acctMatch = a.length >= 4 && b.length >= 4 && (a === b || a.endsWith(b) || b.endsWith(a));
  }

  let reason: string | null = null;
  if (!ocrDateStr && !ocr.accountNumber) {
    reason = "AI อ่านสลิปนี้ไม่ออก — กรุณาตรวจสอบด้วยตาเอง";
  } else if (!dateMatch && !acctMatch) {
    reason = `วันที่บนสลิป (${ocrDateStr ?? "อ่านไม่ออก"}) และเลขบัญชีปลายทาง ไม่ตรงกับที่บันทึกไว้ (${paidOnStr ?? "-"})`;
  } else if (!dateMatch) {
    reason = `วันที่บนสลิป (${ocrDateStr ?? "อ่านไม่ออก"}) ไม่ตรงกับวันที่บันทึกชำระ (${paidOnStr ?? "-"})`;
  } else if (!configuredAccountNumber) {
    reason = "ยังไม่ได้ตั้งค่าบัญชีธนาคารบริษัทของโครงการนี้ — ไม่สามารถตรวจสอบเลขบัญชีปลายทางได้";
  } else if (!acctMatch) {
    reason = `เลขบัญชีปลายทางบนสลิป ("${ocr.accountNumber}") ไม่ตรงกับบัญชีที่ตั้งค่าไว้ ("${configuredAccountNumber}")`;
  }

  return { dateMatch, acctMatch, ok: dateMatch && acctMatch, reason };
}

export type RentSpacePaymentSlipVerdict = RentSpacePaymentMatchVerdict & {
  ocrAmount: number | null;
  ocrDate: string | null; // "YYYY-MM-DD" Bangkok-local
  ocrAccountName: string | null;
  ocrAccountNumber: string | null;
  ocrRefNo: string | null;
  configuredAccountNumber: string | null;
};

/**
 * ดึงผลตรวจสลิปของ payment แถวเดียว — cache-first (ocrReadAt เซ็ตแล้ว = ไม่เรียก AI ซ้ำ
 * เด็ดขาด ประหยัดต้นทุน + เร็ว) ยังไม่เคยอ่าน = เรียก runRentSpaceSlipCheck (ใช้ตัวเดิม
 * ที่ actRecordPayment เรียกอยู่แล้ว — ไม่สร้าง Gemini boilerplate ซ้ำ) แล้วอ่านค่าที่เพิ่ง
 * persist กลับมาคำนวณ verdict. เรียกได้จาก popup ที่เปิดดูบิล — ต่อ payment ไม่ต่อทั้งตาราง
 * (ขอบเขต 1 ห้อง/1 เดือนที่ user เปิดดูจริงเท่านั้น คุมต้นทุน AI).
 */
export async function getOrRunRentSpacePaymentSlipCheck(args: {
  orgId: string;
  paymentId: string;
  actor: { userId: string; orgId: string };
}): Promise<RentSpacePaymentSlipVerdict | null> {
  const { orgId, paymentId, actor } = args;

  const payment = await prisma.rentalPayment.findFirst({
    where: { id: paymentId, orgId },
    select: {
      contractId: true,
      slipUrl: true,
      paidOn: true,
      ocrAmount: true,
      ocrDate: true,
      ocrAccountName: true,
      ocrAccountNumber: true,
      ocrRefNo: true,
      ocrReadAt: true,
      bill: { select: { projectId: true } },
    },
  });
  if (!payment || !payment.slipUrl) return null;

  let ocrAmount = payment.ocrAmount;
  let ocrDate = payment.ocrDate;
  let ocrAccountName = payment.ocrAccountName;
  let ocrAccountNumber = payment.ocrAccountNumber;
  let ocrRefNo = payment.ocrRefNo;

  if (!payment.ocrReadAt) {
    // ยังไม่เคยอ่าน (payment เก่าก่อนฟีเจอร์นี้ หรือ auto-check ตอนอัปโหลดล้มเหลว) — อ่านครั้งนี้
    // แล้วเก็บถาวร ครั้งถัดไปจะเจอ ocrReadAt แล้วไม่เรียก AI ซ้ำ (idempotent)
    await runRentSpaceSlipCheck({
      orgId,
      projectId: payment.bill.projectId,
      contractId: payment.contractId,
      paymentId,
      slipUrl: payment.slipUrl,
      actor,
    });
    const refreshed = await prisma.rentalPayment.findUnique({
      where: { id: paymentId },
      select: {
        ocrAmount: true,
        ocrDate: true,
        ocrAccountName: true,
        ocrAccountNumber: true,
        ocrRefNo: true,
      },
    });
    if (refreshed) {
      ocrAmount = refreshed.ocrAmount;
      ocrDate = refreshed.ocrDate;
      ocrAccountName = refreshed.ocrAccountName;
      ocrAccountNumber = refreshed.ocrAccountNumber;
      ocrRefNo = refreshed.ocrRefNo;
    }
  }

  const configuredAccountNumber = await resolveConfiguredAccountNumber(payment.bill.projectId);
  const ocrDateStr = bkkDateStr(ocrDate);
  const verdict = evaluatePaymentSlipMatch({
    paidOn: payment.paidOn,
    ocr: { date: ocrDate, accountNumber: ocrAccountNumber },
    configuredAccountNumber,
  });

  return {
    ...verdict,
    ocrAmount,
    ocrDate: ocrDateStr,
    ocrAccountName,
    ocrAccountNumber,
    ocrRefNo,
    configuredAccountNumber,
  };
}
