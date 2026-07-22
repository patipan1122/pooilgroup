// PO → AP conversion CORE (ลงบัญชีจริง) — shared by BOTH paths:
//   1. ปุ่ม "แปลงเป็น AP" ในเว็บ (มี session) → convertExpenseToAp action ใน _actions.ts
//   2. อัตโนมัติ พอสลิป/การจ่ายถูกแนบกับบิล (ไม่มี session — LINE webhook) → autoConvertAfterSlip
//
// CEO 2026-07-21: พอได้สลิปโอน หรือกดเองในโปรแกรม → สร้างใบ AP ที่ "ผังบัญชีถูกอัตโนมัติ"
// (Dr ค่าใช้จ่าย GL + Dr ภาษีซื้อ 1432000 / Cr เจ้าหนี้ 2101000 · TRCloud ลงให้จาก
// acc_code+tax_report+AP type) เป็น "ร่าง" (approve_status=wait) ให้บัญชี approve —
// พนักงานไม่ต้องเลือกเดบิต/เครดิตเอง (แก้ปัญหาเลือกผิด).
//
// ทั้งสอง path เรียก core เดียวกัน (runApConversion) → ตรรกะบัญชี + guard เหมือนกันเป๊ะ
// ไม่แตกเป็นสองชุด. Guard ที่ย้ายมา: แปลงแล้ว-ข้าม (idempotent) · ต้องเป็น PO ที่ส่งแล้ว ·
// ต้อง confirmed/locked. การสร้าง AP จริง (search-before-create + ap/create + ลบ PO seed)
// ยังอยู่ใน convertExpensePoToAp เดิม — ไม่แตะ.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { loadPushable } from "@/lib/ledger/pushable";
import { convertExpensePoToAp, trcloudPushConfigured } from "@/lib/ledger/trcloud-push";
import { isTrcloudSent } from "@/lib/ledger/trcloud-state";
import { audit } from "@/lib/audit/log";

export type RunApConversionResult =
  | { ok: true; apDocId: string | null; apDocNo: string | null; alreadyAp?: boolean }
  | { ok: false; error: string };

/**
 * CORE ที่ทั้งปุ่มเว็บและ auto-trigger ใช้ร่วมกัน. รับ orgId/companyId/expenseId + actorUserId
 * (คนกดในเว็บ = session.user.id · path ไม่มี session = null).
 *
 * NOTE: การตรวจสิทธิ์ (requireLedgerAccess + expense.export permission) อยู่ที่ชั้น action
 * ไม่ใช่ที่นี่ — core นี้ถูกเรียกทั้งจาก action (ผ่านสิทธิ์แล้ว) และจาก auto-trigger (server-to-server
 * หลังสลิปเข้า ไม่มี session ให้ตรวจ). Caller ต้องรับผิดชอบ auth เอง.
 */
export async function runApConversion(
  orgId: string,
  companyId: string,
  expenseId: string,
  actorUserId: string | null,
): Promise<RunApConversionResult> {
  const row = await prisma.ledgerExpense.findFirst({
    where: { id: expenseId, orgId, companyId },
    select: {
      companyId: true,
      trcloudDocId: true,
      trcloudDocNo: true,
      trcloudApDocId: true,
      trcloudApDocNo: true,
    },
  });
  if (!row) return { ok: false, error: "ไม่พบรายการ" };
  // แปลงแล้ว → idempotent skip (ไม่สร้าง AP ซ้ำ)
  if (row.trcloudApDocId) return { ok: true, alreadyAp: true, apDocId: row.trcloudApDocId, apDocNo: row.trcloudApDocNo };
  // ต้องส่งเข้า TRCloud เป็น PO ตั้งต้นก่อน จึงจะแปลงเป็น AP ได้
  if (!isTrcloudSent(row.trcloudDocId)) {
    return { ok: false, error: "ต้องส่งเข้า TRCloud (PO) ก่อน แล้วจึงแปลงเป็น AP" };
  }
  const loaded = await loadPushable(orgId, expenseId, companyId);
  if (!loaded) return { ok: false, error: "ไม่พบรายการ" };
  if (loaded.status !== "confirmed" && loaded.status !== "locked") {
    return { ok: false, error: "แปลงเป็น AP ได้เฉพาะรายการที่ยืนยันแล้ว" };
  }
  // 🔴 กันลงบัญชีผิด (CEO 2026-07-22): ถ้าหมวดค่าใช้จ่ายยังไม่ผูกรหัสผังบัญชี (categoryAccCode
  // ว่าง เพราะยังไม่เลือกหมวด หรือหมวดที่เลือกไม่มีรหัส GL) → ห้ามแปลง. เดิมมันตกไปบัญชีถังรวม
  // 5919999 "รายจ่ายยังไม่ได้แยกประเภท" ที่ TRCloud ไม่มีสูตรลงบัญชี → error "formula cannot be
  // empty" + ยอดรวม 0. บังคับเลือกหมวดที่มีผังบัญชีก่อน (auto-trigger จะ no-op เงียบ ๆ · ปุ่ม/bulk
  // เด้ง error ให้ผู้ใช้ไปเลือกหมวด). ครอบทุก path เพราะเป็น core เดียว.
  if (!loaded.pushable.categoryAccCode) {
    return {
      ok: false,
      error: "ยังไม่ได้เลือกหมวดค่าใช้จ่าย (ผังบัญชี) — เลือกหมวดก่อนจึงแปลงเป็น AP ได้ (กันลงบัญชีตกถังรวม)",
    };
  }
  // สลิปโอน (ถ้ามี · จับคู่กับใบนี้แล้ว) → แนบลิงก์เข้าใบ AP
  const slip = await prisma.ledgerPayment.findFirst({
    where: { matchedExpenseId: expenseId, orgId, slipUrl: { not: null } },
    orderBy: { paidAt: "desc" },
    select: { slipUrl: true },
  });
  // po_id ตัวเลข (ไม่ใช่ sentinel "sent"/"pending"/"error") → ใช้ลบ PO seed หลังแปลง
  const poDocId = row.trcloudDocId && /^\d+$/.test(row.trcloudDocId) ? row.trcloudDocId : null;

  await audit({
    orgId,
    // path ไม่มี session (auto-trigger) → userId=null (audit รับ null ได้)
    userId: actorUserId,
    action: "LEDGER_EXPENSE_AP_CONVERT_STARTED",
    resourceType: "ledger_expense",
    resourceId: expenseId,
    diff: { new: { docCode: loaded.pushable.docCode, total: loaded.pushable.total } },
  });

  const res = await convertExpensePoToAp(loaded.pushable, { poDocId, slipUrl: slip?.slipUrl ?? null });
  if (!res.ok) {
    await prisma.ledgerExpense.updateMany({
      where: { id: expenseId, orgId, companyId },
      data: { trcloudApError: res.error.slice(0, 500) },
    });
    await audit({
      orgId,
      userId: actorUserId,
      action: "LEDGER_EXPENSE_AP_CONVERT_FAILED",
      resourceType: "ledger_expense",
      resourceId: expenseId,
      diff: { new: { error: res.error.slice(0, 500) } },
    });
    return { ok: false, error: res.error };
  }
  await prisma.ledgerExpense.updateMany({
    where: { id: expenseId, orgId, companyId },
    data: {
      trcloudApDocId: res.apDocId ?? "sent",
      trcloudApDocNo: res.apDocNo,
      trcloudApAt: new Date(),
      trcloudApError: null,
    },
  });
  await audit({
    orgId,
    userId: actorUserId,
    action: "LEDGER_EXPENSE_AP_CONVERTED",
    resourceType: "ledger_expense",
    resourceId: expenseId,
    diff: { new: { trcloudApDocNo: res.apDocNo, trcloudApDocId: res.apDocId } },
  });
  revalidatePath("/ledger/expenses");
  revalidatePath("/ledger");
  return { ok: true, apDocId: res.apDocId, apDocNo: res.apDocNo };
}

/**
 * BEST-EFFORT auto-convert หลังสลิป/การจ่ายถูกแนบกับบิล (เรียกจาก recordSlipPayment
 * หลัง transaction commit). ครอบทั้ง web cash path และ LINE-webhook slip path เพราะ
 * ทั้งคู่วิ่งผ่าน recordSlipPayment.
 *
 * ⚠️ ห้าม throw เด็ดขาด — ถ้าแปลง AP พลาด ห้ามทำให้ flow บันทึกการจ่ายพัง (เงินโอนจริง
 * ต้องบันทึกสำเร็จเสมอ · การลงบัญชี AP เป็นงานตามหลังที่ retry ได้ผ่านปุ่มเว็บ). error ถูก
 * กลืน + log ไว้เท่านั้น. runApConversion เองก็ idempotent (แปลงแล้ว-ข้าม) จึงเรียกซ้ำได้.
 */
export async function autoConvertAfterSlip(
  orgId: string,
  companyId: string,
  expenseId: string,
  actorUserId: string | null,
): Promise<void> {
  try {
    // ต้องตั้งค่า TRCloud ก่อน (env TRCLOUD_JPS_*) — ไม่งั้นเงียบ ๆ ไม่ต้องทำอะไร
    if (!trcloudPushConfigured()) return;
    await runApConversion(orgId, companyId, expenseId, actorUserId);
  } catch (e) {
    // best-effort: กลืน error ทุกกรณี ห้ามให้กระทบ payment flow
    console.error("[ledger:auto-ap]", e);
  }
}
