// AP → PV (ใบสำคัญจ่าย / payment voucher) auto-create — เกิดหลังบิลถูก "จ่ายแล้ว" + แปลงเป็น AP.
//
// CEO 2026-07-25: พอสลิป/เงินสดปิดบิล → recordSlipPayment พลิกเป็น paid → autoConvertAfterSlip
// สร้างใบ AP (Credit[AP] ตั้งเจ้าหนี้) → จากนั้นเราออก "ใบสำคัญจ่าย (PV)" อัตโนมัติ เพื่อโพสต์ฝั่งจ่ายเงิน:
//     Dr 2101000 (เจ้าหนี้การค้า) / Cr <บัญชีธนาคารที่จ่าย>
// TRCloud เลือกบัญชีธนาคาร (Cr) จาก "type label" ของ PV เอง (ไม่ต้องส่ง gl_entry):
//     SCB[PV]→1013000 · KBANK[PV]→1012004 · BBL[PV]→1011008 · TTB[PV]→1016000
// ไม่มี PV เงินสด → fallback ใช้ SCB[PV]. หัก ณ ที่จ่าย (ถ้ามี) ลงที่ PV ผ่านช่อง head.wht.
//
// เป็นงาน "ตามหลัง" แบบ best-effort เหมือน autoConvertAfterSlip: idempotent (มี PV แล้ว-ข้าม),
// กลืน error ทั้งหมด (เก็บลง trcloudPvError) — ห้าม throw/บล็อก flow บันทึกการจ่าย (เงินจริง).

import { prisma } from "@/lib/prisma";
import { loadPushable } from "@/lib/ledger/pushable";
import {
  AP_COMPANY_FORMAT,
  asObj,
  digitsOnly,
  errMsg,
  isSuccess,
  pick,
  post,
  resolveContactId,
  round2,
  toIsoDate,
  trcloudPushConfigured,
} from "@/lib/ledger/trcloud-push";

/**
 * FEATURE FLAG — เปิด "auto-PV + AP เป็น Credit[AP]/approve=yes" ต่อเมื่อ
 *   LEDGER_AUTO_PV_ENABLED = "true" หรือ "1" เท่านั้น.
 * ไม่ตั้งค่า / "false" / "0" / อื่น ๆ = ปิด → deploy แล้วพฤติกรรมเดิม 100% (zero behavior change).
 * ใช้ตัวเดียวกันทั้ง 2 จุด (hook ใน payments.ts + AP behaviour ใน convertExpensePoToAp)
 * ยกเว้น testCreatePvForAp (manual test) ที่เรียก createPvForPaidAp ตรง ๆ โดยไม่ผ่าน flag.
 */
export function isAutoPvEnabled(): boolean {
  const v = (process.env.LEDGER_AUTO_PV_ENABLED ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}

// approve_id เดียวกับ push อื่น (fuelos IV ใช้ค่านี้) — TRCloud ต้องรู้ว่าใครเป็นผู้อนุมัติ.
const APPROVE_ID = process.env.TRCLOUD_APPROVE_ID ?? "1";
// พนักงานผู้ทำรายการ (optional) — ยังไม่มี mapping ราย user → ปล่อยว่าง (TRCloud รับได้).
const STAFF = process.env.TRCLOUD_PV_STAFF ?? "";

/** ธนาคารต้นทางที่จ่าย → PV type label. บัญชีธนาคาร Cr ถูกเลือกโดย TRCloud จาก label นี้.
 *  ไม่รู้จัก/ว่าง → SCB[PV] (ไม่มี PV เงินสด · SCB 813-409-4107 เป็นบัญชีจ่ายหลัก). */
export function pvLabelForBank(bankCode: string): string {
  switch ((bankCode || "").trim().toUpperCase()) {
    case "SCB":
      return "SCB[PV]";
    case "KBANK":
      return "KBANK[PV]";
    case "BBL":
      return "BBL[PV]";
    case "TTB":
      return "TTB[PV]";
    default:
      return "SCB[PV]";
  }
}

export interface CreatePvArgs {
  orgId: string;
  companyId: string;
  expenseId: string;
  /** ธนาคารต้นทางที่จ่าย (v1: default "SCB"). TODO v1.1: ให้ผู้ใช้เลือกใน dialog ขอโอน. */
  sourceBankCode?: string;
  /** คนกดในเว็บ (audit) — path อัตโนมัติ (สลิป) = null. */
  actorUserId?: string | null;
}

/**
 * ออกใบสำคัญจ่าย (PV) ให้กับ AP ที่จ่ายแล้ว — IDEMPOTENT + BEST-EFFORT (ไม่ throw).
 *  1. มี trcloudPvDocId แล้ว → ข้าม (กันออกซ้ำ).
 *  2. ยังไม่มี AP (trcloudApDocNo ว่าง) → ยังออก PV ไม่ได้ (ต้องมีใบ AP ให้อ้างอิงก่อน) → ข้ามเงียบ ๆ.
 *  3. สร้าง payload จาก expense + AP + ธนาคารต้นทาง → POST pv/create.php ผ่าน helper เดิม (auth/signing ชุดเดียว).
 *  4. สำเร็จ → เก็บ trcloudPvDocId/No/At · ล้มเหลว → เก็บ trcloudPvError แล้ว return (ไม่ throw).
 */
export async function createPvForPaidAp(args: CreatePvArgs): Promise<void> {
  const { orgId, companyId, expenseId } = args;
  const sourceBankCode = args.sourceBankCode ?? "SCB";
  try {
    if (!trcloudPushConfigured()) return; // ยังไม่ตั้งค่า TRCloud → เงียบ ๆ (เหมือน autoConvertAfterSlip)

    // 1) idempotency + ต้องมี AP ก่อน — อ่าน state ที่ stamp ไว้บน expense
    const row = await prisma.ledgerExpense.findFirst({
      where: { id: expenseId, orgId, companyId },
      select: { trcloudPvDocId: true, trcloudApDocNo: true, trcloudApDocId: true, paymentStatus: true },
    });
    if (!row) return;
    if (row.trcloudPvDocId) return; // มี PV แล้ว → idempotent skip
    // PV ต้องอ้างอิงใบ AP (document_number) → ถ้ายังไม่มีเลข AP ก็ออก PV ไม่ได้ (best-effort skip)
    if (!row.trcloudApDocNo) {
      await stampPvError(orgId, companyId, expenseId, "ยังไม่มีเลขเอกสาร AP — ออก PV ยังไม่ได้");
      return;
    }

    // 2) โหลดข้อมูลบิล (ยอด · ผู้ขาย · แผนก/โครงการ) — shape เดียวกับที่ AP ใช้
    const loaded = await loadPushable(orgId, expenseId, companyId);
    if (!loaded) return;
    const e = loaded.pushable;
    if (!e.branchTrcloudDepartment) {
      await stampPvError(orgId, companyId, expenseId, "สาขานี้ยังไม่มีรหัสแผนก TRCloud");
      return;
    }

    // 3) contact snapshot — reuse ตัวเดิมที่ AP ใช้ (cache by tax id → contact_id เดียวกัน)
    const scope = { orgId, companyId };
    const contact = await resolveContactId(scope, {
      vendor: e.vendor,
      vendorTaxId: e.vendorTaxId,
      vendorAddress: e.vendorAddress,
    });
    if (!contact.ok) {
      await stampPvError(orgId, companyId, expenseId, `คู่ค้า: ${contact.error}`);
      return;
    }

    // วันที่จ่าย = วันสลิป (ถ้ามีสลิปจับคู่) · ไม่มี = วันนี้. + ลิงก์สลิปเข้า dropbox.
    const slip = await prisma.ledgerPayment.findFirst({
      where: { matchedExpenseId: expenseId, orgId },
      orderBy: { paidAt: "desc" },
      select: { paidAt: true, slipUrl: true },
    });
    const issueDate = toIsoDate(slip?.paidAt ?? null);
    const pvLabel = pvLabelForBank(sourceBankCode);

    // 4) payload — head (flat) + customer + item(array ของ AP ที่จ่าย) + dropbox(optional)
    const payload: Record<string, unknown> = {
      issue_date: issueDate,
      company_format: "PV",
      type: pvLabel,               // เลือกบัญชีธนาคาร Cr (SCB[PV]→1013000 ฯลฯ)
      document_number: "",         // autorun
      reference: e.docCode,        // = ref_no ของ AP (ผูก AP↔PV เชิงตรรกะ)
      wht: String(round2(e.wht)),  // หัก ณ ที่จ่าย (0 ถ้าไม่มี) — TRCloud แยก Cr ภาษีหัก ณ ที่จ่าย
      staff: STAFF,
      department: e.branchTrcloudDepartment,     // เดียวกับ AP (นิติบุคคล)
      project: e.branchTrcloudProject ?? "",     // เดียวกับ AP (สาขา · ส่วนกลางว่างได้)
      approve_status: "", // ว่าง = ไม่ติดรอแก้ไข + ยังลบได้ ("yes" ล็อกถาวร ลบไม่ได้ · dormant path)
      approve_id: APPROVE_ID,
      customer: {
        group_code: "S",
        code_number: (contact.ref.codeNumber ?? "").replace(/^\D+/, ""),
        name: e.vendor || "ไม่ระบุชื่อผู้ขาย",
        organization: e.vendor || "",
        branch: "00000",
        address: e.vendorAddress || "-",
        email: "",
        telephone: "",
        tax_id: digitsOnly(e.vendorTaxId),
        contact_type: "normal",
        contact_id: contact.ref.contactId,
        add_contact: "0",
      },
      // ITEM — ใบ AP ที่กำลังจ่าย. ⚠️ company_format ใช้ค่าจริงของ AP (JPS_AP) ไม่ใช่ "AP" ตามตัวอย่างเอกสาร.
      // ⚠️ ชื่อ key ของ array นี้ ("item") ยังไม่ได้ยืนยันกับ TRCloud จริง — ตรวจในเทสคุมเดี่ยวก่อนเปิด auto.
      item: [
        {
          company_format: AP_COMPANY_FORMAT,   // = ค่าจริงของ AP ("JPS_AP")
          document_number: row.trcloudApDocNo, // เลขเอกสาร AP ที่จะจ่าย
          amount: round2(e.total),             // ยอดเจ้าหนี้ที่เคลียร์ (เต็มจำนวน · WHT แยกที่ head.wht)
          doc_type: "AP",
        },
      ],
      ...(slip?.slipUrl ? { dropbox: [{ url: slip.slipUrl }] } : {}),
    };

    const r = await post("pv/create.php", payload);
    if (!isSuccess(r.data)) {
      await stampPvError(orgId, companyId, expenseId, errMsg(r).slice(0, 500));
      return;
    }
    const inner = asObj(r.data?.data) ?? asObj(r.data?.head) ?? r.data;
    const pvDocId = pick(inner, "id", "document_id", "doc") ?? pick(r.data, "id", "document_id", "doc");
    const pvDocNo = pick(inner, "document_number", "no") ?? pick(r.data, "document_number", "no");
    if (!pvDocId && !pvDocNo) {
      await stampPvError(orgId, companyId, expenseId, `TRCloud ไม่คืนเลขเอกสาร PV — ออกไม่สำเร็จ (${errMsg(r)})`);
      return;
    }
    await prisma.ledgerExpense.updateMany({
      where: { id: expenseId, orgId, companyId },
      data: {
        trcloudPvDocId: pvDocId ?? "sent",
        trcloudPvDocNo: pvDocNo,
        trcloudPvAt: new Date(),
        trcloudPvError: null,
      },
    });
  } catch (e) {
    // best-effort: กลืน error ทุกกรณี — ห้ามกระทบ flow บันทึกการจ่าย
    console.error("[ledger:auto-pv]", e);
    await stampPvError(orgId, companyId, expenseId, e instanceof Error ? e.message.slice(0, 500) : "PV error").catch(
      () => {},
    );
  }
}

/** เก็บ error ล่าสุดของการออก PV (best-effort — ไม่ throw ต่อ). */
async function stampPvError(orgId: string, companyId: string, expenseId: string, msg: string): Promise<void> {
  await prisma.ledgerExpense
    .updateMany({ where: { id: expenseId, orgId, companyId }, data: { trcloudPvError: msg.slice(0, 500) } })
    .catch(() => {});
}
