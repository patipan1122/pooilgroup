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
import { prisma } from "@/lib/prisma";
import { adminClient } from "@/lib/db/server";
import { extractSlipDetails, type SlipOcrDetails } from "@/lib/chairops/reconcile/slip-ocr";

export { extractSlipDetails };
export type { SlipOcrDetails };

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
