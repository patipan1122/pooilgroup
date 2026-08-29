// AI อ่านสลิป + ตรวจสลิปซ้ำ/บัญชีปลายทางผิด สำหรับ RentSpace (2026-08-29)
// เรียกยืม extractSlipDetails ตรงจาก ChairOps (ฟังก์ชันทั่วไป ไม่ผูก type ChairOps)
// แต่เขียน dup-check ของตัวเองเพราะ checkSlipFraud เดิมผูกกับตาราง ChairopsCashDeposit
// ตรง ๆ — RentSpace ใช้ RentalPayment แทน ขอบเขตซ้ำ = "สัญญาเดียวกัน" (เงินตามผู้เช่า
// ไม่ใช่ตามห้อง — ผู้เช่าย้ายห้อง/มี 2 สัญญาไม่ควรชนกัน)
import { prisma } from "@/lib/prisma";
import { adminClient } from "@/lib/db/server";
import { extractSlipDetails, type SlipOcrDetails } from "@/lib/chairops/reconcile/slip-ocr";

export { extractSlipDetails };
export type { SlipOcrDetails };

const normalizeName = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export type RentSpaceSlipFraudCheck = { flagged: boolean; reason: string | null };

export async function checkRentSpaceSlipFraud(args: {
  orgId: string;
  contractId: string;
  paymentId: string;
  ocr: SlipOcrDetails;
  configuredAccountName: string | null;
}): Promise<RentSpaceSlipFraudCheck> {
  const { orgId, contractId, paymentId, ocr, configuredAccountName } = args;

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

  if (configuredAccountName && ocr.accountName) {
    const a = normalizeName(configuredAccountName);
    const b = normalizeName(ocr.accountName);
    const matches = a.length > 0 && b.length > 0 && (a.includes(b) || b.includes(a));
    if (!matches) {
      return {
        flagged: true,
        reason: `ชื่อบัญชีปลายทางบนสลิป ("${ocr.accountName}") ดูไม่ตรงกับบัญชีที่ตั้งค่าไว้ ("${configuredAccountName}") — กรุณาตรวจสอบว่าเงินเข้าบัญชีถูกต้อง`,
      };
    }
  }

  return { flagged: false, reason: null };
}

async function resolveConfiguredAccountName(projectId: string): Promise<string | null> {
  const project = await prisma.rentalProject.findUnique({
    where: { id: projectId },
    select: { reconcileBankAccountId: true },
  });
  if (!project?.reconcileBankAccountId) return null;
  const admin = adminClient();
  const { data: acc } = await admin
    .from("ledger_bank_account")
    .select("account_name")
    .eq("id", project.reconcileBankAccountId)
    .maybeSingle();
  return (acc?.account_name as string | undefined) ?? null;
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
    const configuredAccountName = await resolveConfiguredAccountName(projectId);
    const check = await checkRentSpaceSlipFraud({ orgId, contractId, paymentId, ocr, configuredAccountName });
    await prisma.rentalPayment.update({
      where: { id: paymentId },
      data: {
        ocrAmount: ocr.amount,
        ocrDate: ocr.date ? new Date(`${ocr.date}T00:00:00.000Z`) : null,
        ocrAccountName: ocr.accountName,
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
