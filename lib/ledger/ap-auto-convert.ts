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
import {
  convertExpensePoToAp,
  trcloudPushConfigured,
  createPvForRequestAps,
  pvFormulaForBank,
  type PvItem,
} from "@/lib/ledger/trcloud-push";
import { isTrcloudSent } from "@/lib/ledger/trcloud-state";
import { audit } from "@/lib/audit/log";
import { llCSlotForGl } from "@/lib/ledger/coa-chart";
import { isAutoPvEnabled } from "@/lib/ledger/trcloud-pv";

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
  opts: { creditForm?: boolean } = {},
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
  // 🔴 กันลงบัญชีผิด รอบ 2 (CEO 2026-08-11 · AP 551563 เบียร์ Hotel MIX ตก 5919999): "มี categoryAccCode"
  // ไม่พอ — ต้องเป็นหมวดที่ "สูตร LL" รู้จักด้วย (llCSlotForGl ไม่ null) ไม่งั้น convertExpensePoToAp
  // จะ fallback ไป Credit[AP]/Cash[AP] เดิม ซึ่ง Product2GL:AUTO ของ TRCloud ตก 5919999 เสมอ (SKU
  // JPS-100/101/103 มี acc_buy ว่างถาวร — พิสูจน์แล้วหลายรอบ ไม่มีทางเลี่ยงอื่น). เดิม guard ด้านบน
  // (2026-07-22) เช็คแค่ "มี GL" — หมวด COGS/สินค้าซื้อมาขาย (เช่น เบียร์ GL 5101000) มี GL จริงแต่ไม่
  // อยู่ใน 21 หมวด LL จึงหลุดผ่าน guard เดิมตรงเข้าบั๊กที่ guard ถูกสร้างมาเพื่อกันพอดี.
  //
  // เคสที่สอง: บิล "จ่ายแล้ว" (paymentStatus=paid) โดยไม่ใช่ creditForm/autoPv — โค้ด trcloud-push.ts
  // จะไม่พยายาม LL เลย (fallback Cash[AP] ตรง ๆ) แม้หมวดจะอยู่ใน LL ก็ตาม → เสี่ยง 5919999 เหมือนกัน
  // จนกว่า LEDGER_AUTO_PV_ENABLED จะเปิด (หรือมาทาง creditForm). เช็ค 2 เงื่อนไขนี้ mirror
  // trcloud-push.ts:convertExpensePoToAp ตรง ๆ — แก้ที่นั่นต้องแก้ที่นี่คู่กันเสมอ.
  const creditForm = opts.creditForm === true;
  const willAttemptLL = creditForm || isAutoPvEnabled() || (loaded.pushable.paymentStatus ?? "unpaid") !== "paid";
  if (!willAttemptLL) {
    return {
      ok: false,
      error:
        "บิลนี้ถูกจ่ายไปแล้วก่อนแปลงเป็น AP — ระบบยังลงบัญชีผ่านสูตรเดิมที่ตกถังรวม 5919999 เสมอในเคสนี้ " +
        "กรุณาแปลงเป็น AP ก่อนจ่ายเงิน หรือแจ้งทีมเทคนิคเปิดฟีเจอร์ PV อัตโนมัติก่อน",
    };
  }
  if (!llCSlotForGl(loaded.pushable.categoryAccCode)) {
    return {
      ok: false,
      error:
        `หมวด "${loaded.pushable.categoryName ?? "-"}" ยังไม่รองรับการลงบัญชีอัตโนมัติ (ไม่มีในสูตร LL ของ TRCloud) ` +
        "— แจ้งบัญชีเพิ่มหมวดนี้ในสูตร LL ก่อน หรือเปลี่ยนเป็นหมวดที่รองรับแล้ว (กันลงบัญชีตกถังรวม 5919999)",
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

  const res = await convertExpensePoToAp(loaded.pushable, {
    poDocId,
    slipUrl: slip?.slipUrl ?? null,
    creditForm: opts.creditForm === true,
  });
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

// ─────────────────────────────────────────────────────────────────────────────
// PV (ใบสำคัญจ่าย) หลังสลิปโอนปิด "คำขอโอน" — 1 การโอน = 1 PV อ้างทุก AP ในคำขอ.
// เส้นทาง: สลิปแมทช์ปิดคำขอ (state=paid) → แปลงทุกบิล PO→AP (idempotent) → สร้าง PV จ่าย
// จากธนาคารต้นทาง (อ่านจากสลิป). ลงบัญชี "จ่ายจริง": Dr เจ้าหนี้ / Cr หัก ณ ที่จ่าย / Cr ธนาคาร.
// CEO 2026-07-25: "แมทช์ยอด → เปลี่ยน PO เป็น AP → ออก PV อัตโนมัติ ดูบัญชีต้นทางจากสลิป".
// ─────────────────────────────────────────────────────────────────────────────

export type RunPvResult =
  | { ok: true; pvDocNo?: string | null; alreadyPv?: boolean; skipped?: string }
  | { ok: false; error: string };

async function stampPvError(orgId: string, companyId: string, requestId: string, err: string): Promise<void> {
  await prisma.ledgerPaymentRequest.updateMany({
    where: { id: requestId, orgId, companyId },
    data: { trcloudPvError: err.slice(0, 500) },
  });
}

/**
 * CORE สร้าง PV สำหรับ 1 คำขอโอน. idempotent (มี PV แล้ว-ข้าม) · all-or-nothing (บิลใด
 * ยังไม่มี AP → ไม่ออก PV กันจ่ายขาด/เกิน · เงินโอนจริงถูกบันทึกไปแล้ว · PV retry ได้).
 * ห้ามเรียกก่อนคำขอ state=paid — ฟังก์ชันเช็คเองแล้ว no-op ถ้ายังจ่ายไม่ครบ.
 */
export async function runPvForRequest(
  orgId: string,
  companyId: string,
  requestId: string,
  actorUserId: string | null,
): Promise<RunPvResult> {
  const req = await prisma.ledgerPaymentRequest.findFirst({
    where: { id: requestId, orgId, companyId },
    select: {
      state: true,
      trcloudPvDocId: true,
      vendor: true,
      whtTotal: true,
      paidAt: true,
      bills: { where: { active: true }, select: { expenseId: true, billAmount: true } },
      payments: { orderBy: { paidAt: "desc" }, take: 1, select: { sendingBank: true } },
    },
  });
  if (!req) return { ok: false, error: "ไม่พบคำขอโอน" };
  // ยังจ่ายไม่ครบ (partial/open) → ยังไม่ออก PV (รอปิดคำขอ)
  if (req.state !== "paid") return { ok: true, skipped: "not-fully-paid" };
  // ออก PV แล้ว → idempotent skip (ไม่จ่ายซ้ำ)
  if (req.trcloudPvDocId) return { ok: true, alreadyPv: true };
  if (req.bills.length === 0) return { ok: false, error: "คำขอไม่มีบิล" };

  // 1) ทุกบิล → ต้องมี AP (แปลง PO→AP ถ้ายัง · idempotent). all-or-nothing.
  const items: PvItem[] = [];
  let vendor: { name: string; taxId: string | null; address: string | null } | null = null;
  let department: string | null = null;
  let project: string | null = null;
  for (const b of req.bills) {
    // creditForm: บิลถูก mark paid ไปแล้วตอนสลิปแมทช์ → บังคับ AP เป็น LL/เครดิต (ตั้งเจ้าหนี้)
    // เพื่อให้ PV เคลียร์เจ้าหนี้ได้ + ผังบัญชีถูก (ไม่ตก 5919999 · ไม่จ่ายซ้ำ).
    const conv = await runApConversion(orgId, companyId, b.expenseId, actorUserId, { creditForm: true });
    if (!conv.ok || !conv.apDocNo) {
      const why = conv.ok ? "AP ไม่มีเลขเอกสาร" : conv.error;
      await stampPvError(orgId, companyId, requestId, `บิลยังแปลงเป็น AP ไม่ครบ (${why})`);
      return { ok: false, error: `ยังออก PV ไม่ได้ — มีบิลที่ยังไม่มี AP (${why})` };
    }
    items.push({ apDocNo: conv.apDocNo, amount: Number(b.billAmount), detail: null });
    // คู่ค้า/สาขา จากบิลแรก (ทุกบิลในคำขอเดียว = payee เดียวกัน)
    if (!vendor) {
      const pe = await loadPushable(orgId, b.expenseId, companyId);
      if (pe) {
        vendor = {
          name: pe.pushable.vendor ?? "",
          taxId: pe.pushable.vendorTaxId,
          address: pe.pushable.vendorAddress,
        };
        department = pe.pushable.branchTrcloudDepartment ?? null;
        project = pe.pushable.branchTrcloudProject ?? null;
      }
    }
  }
  if (!vendor || !department) {
    await stampPvError(orgId, companyId, requestId, "ไม่มีข้อมูลคู่ค้า/รหัสแผนก TRCloud");
    return { ok: false, error: "ไม่มีข้อมูลคู่ค้า/รหัสแผนก TRCloud สำหรับ PV" };
  }

  // 2) สูตร PV ตาม "ธนาคารต้นทาง" ที่อ่านจากสลิป (ไม่มี QR → บัญชีหลัก default)
  const srcBank = req.payments[0]?.sendingBank ?? null;
  const pf = pvFormulaForBank(srcBank);

  await audit({
    orgId,
    userId: actorUserId,
    action: "LEDGER_PV_CREATE_STARTED",
    resourceType: "ledger_payment_request",
    resourceId: requestId,
    diff: { new: { formula: pf.formula, sourceBank: srcBank, bankMatched: pf.matched, apCount: items.length } },
  });

  const res = await createPvForRequestAps({
    orgId,
    companyId,
    reference: `PVREQ-${requestId}`,
    formula: pf.formula,
    department,
    project,
    vendor,
    whtTotal: Number(req.whtTotal),
    issueDate: req.paidAt ?? new Date(),
    note: `จ่าย ${vendor.name ?? ""}`.trim(),
    items,
  });
  if (!res.ok) {
    await stampPvError(orgId, companyId, requestId, res.error);
    await audit({
      orgId,
      userId: actorUserId,
      action: "LEDGER_PV_CREATE_FAILED",
      resourceType: "ledger_payment_request",
      resourceId: requestId,
      diff: { new: { error: res.error.slice(0, 500) } },
    });
    return { ok: false, error: res.error };
  }

  await prisma.ledgerPaymentRequest.updateMany({
    where: { id: requestId, orgId, companyId },
    data: {
      trcloudPvDocId: res.pvDocId ?? "sent",
      trcloudPvDocNo: res.pvDocNo,
      trcloudPvAt: new Date(),
      trcloudPvError: null,
      pvSourceBank: pf.bankAbbr ?? srcBank,
    },
  });
  await audit({
    orgId,
    userId: actorUserId,
    action: "LEDGER_PV_CREATED",
    resourceType: "ledger_payment_request",
    resourceId: requestId,
    diff: { new: { trcloudPvDocNo: res.pvDocNo, trcloudPvDocId: res.pvDocId, formula: pf.formula } },
  });
  revalidatePath("/ledger/reconcile");
  return { ok: true, pvDocNo: res.pvDocNo };
}

/**
 * BEST-EFFORT: สร้าง PV หลังสลิปปิดคำขอ (เรียกจาก LINE webhook + ปุ่มจับคู่สลิปในเว็บ).
 * ⚠️ ห้าม throw — เงินโอนจริง+บิล paid ถูกบันทึกไปแล้ว. PV เป็นงานตามหลัง (retry ได้).
 * runPvForRequest idempotent + no-op ถ้ายังจ่ายไม่ครบ → เรียกซ้ำ/เรียกก่อนเวลาปลอดภัย.
 */
export async function autoCreatePvAfterMatch(
  orgId: string,
  companyId: string,
  requestId: string,
  actorUserId: string | null,
): Promise<void> {
  try {
    if (!trcloudPushConfigured()) return;
    await runPvForRequest(orgId, companyId, requestId, actorUserId);
  } catch (e) {
    console.error("[ledger:auto-pv]", e);
  }
}
