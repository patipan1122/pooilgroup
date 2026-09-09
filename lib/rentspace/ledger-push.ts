// RentSpace → LedgerLine bridge: ส่งยอดบิลที่ "จ่ายครบ" เข้า ledger_revenue_entry
// เพื่อรอจับคู่กับ statement ธนาคารจริง (bank-recon) — pattern เดียวกับ
// lib/chairops/reconcile/ledger-push.ts (CEO 2026-08-15): source_type
// discriminator + deterministic source_ref + INSERT...ON CONFLICT WHERE
// match_state='unmatched' (กันส่งซ้ำ อะตอมมิก · กดกี่ครั้งก็ได้ · ไม่แตะรายการ
// ที่จับคู่แล้ว). 'RENTSPACE' อยู่ใน source_type CHECK ของ ledger_revenue_entry
// ตั้งแต่ migration แรก — ไม่ต้องแก้ schema ฝั่ง ledger เลย.
//
// CEO 2026-09-09: ก่อนส่งเข้า ledger เพิ่มด่าน "ยอดสลิปตรงไหม" — เดิมส่ง
// bill.totalAmount เข้า ledger ตรง ๆ โดยไม่เคยเทียบกับยอดที่ AI อ่านได้จากสลิป
// (ocrAmount จาก slip-check.ts ฟีเจอร์ 2026-09-09 ตัวเดียวกับจุดเขียว/แดงใน popup)
// — เช็คนี้แยกจาก evaluatePaymentSlipMatch() เดิม (วันที่+บัญชี) โดยตั้งใจ ไม่แตะ
// จุดเขียว/แดงเดิมเลย เป็นด่านใหม่เฉพาะตอน "จะส่งเข้าบัญชี" เท่านั้น: payment ไหนมี
// สลิปแต่ยอด AI อ่านได้ไม่ตรงกับที่บันทึกไว้ (เกิน 1 บาท) หรืออ่านไม่ออกเลย → กันทั้ง
// "บิล" นั้นไม่ให้ส่งรอบนี้ (fail-closed ทั้งใบ ไม่ใช่แค่รายการนั้น เพราะยอดบิลรวม
// ทุก payment). Payment ที่ไม่มีสลิป (เงินสด/ไม่แนบ) ไม่เข้าเช็คนี้เลย ผ่านเหมือนเดิม.
import { prisma } from "@/lib/prisma";
import { toNum, tenantDisplayName, periodLabel, thaiDateLong, PAYMENT_METHODS } from "@/lib/rentspace/format";
import { getOrRunRentSpacePaymentSlipCheck } from "@/lib/rentspace/slip-check";

export type ProjectReconcileSummary = {
  configured: boolean;
  companyId: string | null;
  bankAccountId: string | null;
  readyCount: number;
  readyAmountBaht: number;
};

function sourceRef(billId: string): string {
  return `rentspace-bill-${billId}`;
}

/** สรุปสถานะบิลที่จ่ายครบของโครงการ — READ-ONLY ใช้เรนเดอร์หน้าตั้งค่า */
export async function getProjectReconcileSummary(
  orgId: string,
  projectId: string,
): Promise<ProjectReconcileSummary> {
  const project = await prisma.rentalProject.findFirst({
    where: { id: projectId, orgId },
    select: { companyId: true, reconcileBankAccountId: true },
  });

  const readyAgg = await prisma.rentalBill.aggregate({
    where: { orgId, projectId, status: "paid" },
    _count: { _all: true },
    _sum: { totalAmount: true },
  });

  return {
    configured: Boolean(project?.companyId && project?.reconcileBankAccountId),
    companyId: project?.companyId ?? null,
    bankAccountId: project?.reconcileBankAccountId ?? null,
    readyCount: readyAgg._count._all,
    readyAmountBaht: toNum(readyAgg._sum.totalAmount),
  };
}

export type SkippedBillForSlipMismatch = {
  billId: string;
  unitCode: string;
  tenantLabel: string;
  period: string; // "YYYY-MM"
  periodLabel: string; // Thai label เช่น "กันยายน 2569"
  /** เหตุผลต่อ payment ที่ทำให้บิลนี้ถูกกัน — อาจมีมากกว่า 1 รายการต่อบิล */
  reasons: string[];
};

export type PushResult = {
  ok: boolean;
  inserted: number;
  /** ยอดรวม (บาท) ของบิลที่ส่งสำเร็จรอบนี้ — ใช้โชว์ "ยอด X บาท" หลังกดส่ง */
  insertedAmountBaht: number;
  alreadySent: number;
  /** บิลที่ถูกกันไม่ให้ส่งรอบนี้ เพราะยอดสลิป (AI อ่าน) ไม่ตรงกับยอดที่บันทึกไว้ — ดู module docblock ด้านบน */
  skippedForSlipMismatch: SkippedBillForSlipMismatch[];
  error?: string;
};

/** รัน fn ทีละไม่เกิน `limit` ตัวพร้อมกัน (worker pool) — ใช้กันยิง Gemini แบบ unbounded-parallel
 *  ตอนโครงการมีบิล/สลิปเยอะ ขณะเดียวกันก็ไม่ serial ทีละใบ (ช้าเกินไปถ้ามีหลายสิบใบ) */
async function runBounded<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

type BillWithPaymentsForGate = {
  id: string;
  payments: {
    id: string;
    paidOn: Date;
    slipUrl: string | null;
    amountThb: unknown; // Prisma.Decimal
  }[];
};

/** เทียบยอดสลิปของบิลเดียว (ทุก payment ที่มีสลิป) กับ ocrAmount ที่อ่านมาแล้ว —
 *  แยกออกมาเป็นฟังก์ชัน pure ต่างหาก (ไม่พึ่ง DB/AI ตรงนี้) เพื่อให้ทดสอบ/verify ได้ตรงๆ
 *  โดยไม่ต้องยิง INSERT เข้า ledger_revenue_entry จริง — ดู scripts/verify-rentspace-slip-gate.
 *  reasons ว่าง = ผ่าน (ส่งได้) · มีค่า = กันทั้งบิล (ดู docblock บนสุดของไฟล์) */
export function evaluateBillSlipGate(
  bill: BillWithPaymentsForGate,
  ocrAmountByPaymentId: Map<string, number | null>,
): string[] {
  const reasons: string[] = [];
  for (const p of bill.payments) {
    if (!p.slipUrl) continue; // ไม่มีสลิป (เงินสด/ไม่แนบ) — ไม่เข้าเช็คนี้ ผ่านเหมือนเดิมทุกประการ
    const recorded = toNum(p.amountThb);
    const ocrAmount = ocrAmountByPaymentId.get(p.id) ?? null;
    if (ocrAmount == null) {
      // อ่านไม่ออก = ประเมินไม่ได้ → fail-closed เหมือน evaluatePaymentSlipMatch เดิม (ไม่ผ่านเงียบๆ)
      reasons.push(`สลิปวันที่ ${thaiDateLong(p.paidOn)} (บันทึกไว้ ${recorded.toLocaleString("th-TH")} บาท) — AI อ่านยอดในสลิปไม่ออก`);
    } else if (Math.abs(ocrAmount - recorded) > 1) {
      reasons.push(
        `สลิปวันที่ ${thaiDateLong(p.paidOn)}: บันทึกไว้ ${recorded.toLocaleString("th-TH")} บาท แต่ AI อ่านยอดในสลิปได้ ${ocrAmount.toLocaleString("th-TH")} บาท`,
      );
    }
  }
  return reasons;
}

/** ส่งบิล "จ่ายครบ" ทั้งหมดของโครงการเข้า ledger_revenue_entry — กดซ้ำได้ไม่จำกัด
 *  source_ref ผูกกับ billId เสมอ ทำให้ ON CONFLICT กันซ้ำอัตโนมัติในระดับฐานข้อมูล
 *  (แถวที่จับคู่ statement แล้วจะไม่ถูกแตะ)
 *  actorUserId: ใช้เป็น actor ตอนต้องเรียก AI อ่านสลิป (ยังไม่เคยอ่าน) — เพื่อบันทึกต้นทุน AI
 *  ให้ตรงคนที่กดส่งจริง (ดู recordAiUsage ใน slip-ocr.ts) */
export async function pushProjectBillsToLedger(
  orgId: string,
  projectId: string,
  actorUserId: string,
): Promise<PushResult> {
  const project = await prisma.rentalProject.findFirst({
    where: { id: projectId, orgId },
    select: { name: true, companyId: true, reconcileBankAccountId: true },
  });
  if (!project) {
    return { ok: false, inserted: 0, insertedAmountBaht: 0, alreadySent: 0, skippedForSlipMismatch: [], error: "ไม่พบโครงการ" };
  }
  if (!project.companyId || !project.reconcileBankAccountId) {
    return {
      ok: false,
      inserted: 0,
      insertedAmountBaht: 0,
      alreadySent: 0,
      skippedForSlipMismatch: [],
      error: "ยังไม่ได้ตั้งค่าบริษัท/บัญชีธนาคารของโครงการนี้ — ตั้งค่าก่อนแล้วค่อยส่ง",
    };
  }

  const bills = await prisma.rentalBill.findMany({
    where: { orgId, projectId, status: "paid" },
    select: {
      id: true,
      period: true,
      totalAmount: true,
      unit: { select: { code: true } },
      tenant: { select: { bizName: true, prefix: true, firstName: true, lastName: true, nickname: true } },
      payments: {
        where: { status: "confirmed" },
        orderBy: { paidOn: "desc" },
        select: {
          id: true,
          paidOn: true,
          method: true,
          slipUrl: true,
          amountThb: true,
          ocrAmount: true,
          ocrReadAt: true,
        },
      },
    },
  });

  if (bills.length === 0) {
    return { ok: true, inserted: 0, insertedAmountBaht: 0, alreadySent: 0, skippedForSlipMismatch: [] };
  }

  // ── ด่านยอดสลิป (Part B, CEO 2026-09-09): ให้แน่ใจว่า payment ที่มีสลิปทุกใบถูก AI
  // อ่านแล้ว (เรียกเฉพาะใบที่ยังไม่เคยอ่าน — ocrReadAt null — cache-first ผ่านฟังก์ชันเดิม
  // ที่ popup matrix ใช้อยู่แล้ว ไม่เขียน OCR-calling path ที่ 2) แล้วเทียบยอด ─────────────
  const actor = { userId: actorUserId, orgId };
  const allConfirmedPayments = bills.flatMap((b) => b.payments);
  const needsRead = allConfirmedPayments.filter((p) => p.slipUrl && !p.ocrReadAt);
  const readVerdicts = await runBounded(needsRead, 4, (p) =>
    getOrRunRentSpacePaymentSlipCheck({ orgId, paymentId: p.id, actor }),
  );
  const ocrAmountByPaymentId = new Map<string, number | null>();
  needsRead.forEach((p, i) => ocrAmountByPaymentId.set(p.id, readVerdicts[i]?.ocrAmount ?? null));
  for (const p of allConfirmedPayments) {
    if (p.slipUrl && !ocrAmountByPaymentId.has(p.id)) {
      // อ่านมาก่อนหน้านี้แล้ว (ocrReadAt ไม่ null ตั้งแต่แรก) — ใช้ค่าที่ persist ไว้ตรงๆ ไม่ต้องอ่านซ้ำ
      ocrAmountByPaymentId.set(p.id, p.ocrAmount);
    }
  }

  const skippedForSlipMismatch: SkippedBillForSlipMismatch[] = [];
  const billsToSend: typeof bills = [];
  for (const b of bills) {
    const reasons = evaluateBillSlipGate(b, ocrAmountByPaymentId);
    if (reasons.length > 0) {
      skippedForSlipMismatch.push({
        billId: b.id,
        unitCode: b.unit.code,
        tenantLabel: tenantDisplayName(b.tenant),
        period: b.period,
        periodLabel: periodLabel(b.period),
        reasons,
      });
    } else {
      billsToSend.push(b);
    }
  }

  let inserted = 0;
  let insertedAmountBaht = 0;
  try {
    for (const b of billsToSend) {
      const lastPayment = b.payments[0];
      const entryDate = lastPayment?.paidOn ?? new Date(); // ไม่ควรเกิด (บิลจ่ายครบต้องมีรายการจ่าย) แต่กันพังไว้
      // channel_code มี CHECK constraint เฉพาะ cash/transfer/card/qr/wallet/cod/other —
      // RentalPayment.method (cash/transfer/qr/card) ตรงกับเซตนี้อยู่แล้วพอดี ใช้ตรงๆ ได้เลย
      const channelCode = lastPayment?.method ?? "transfer";
      const methodLabel = lastPayment ? (PAYMENT_METHODS[lastPayment.method] ?? lastPayment.method) : "โอน";
      const tenantName = tenantDisplayName(b.tenant);
      const description = `RentSpace ค่าเช่า · ${b.unit.code} · ${tenantName} · ${periodLabel(b.period)}`;
      const res = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO ledger_revenue_entry
          (org_id, company_id, entry_date, amount_satang, source_type, source_ref,
           description, customer_name, payment_channel, channel_code, match_state,
           expected_bank_account_id)
        VALUES (
          ${orgId}::uuid, ${project.companyId}::uuid, ${entryDate}::date,
          ${Math.round(toNum(b.totalAmount) * 100)}, 'RENTSPACE', ${sourceRef(b.id)},
          ${description}, ${tenantName}, ${methodLabel}, ${channelCode}, 'unmatched',
          ${project.reconcileBankAccountId}::uuid
        )
        ON CONFLICT (org_id, company_id, source_type, source_ref)
          WHERE source_ref IS NOT NULL
        DO UPDATE SET
          amount_satang = EXCLUDED.amount_satang,
          expected_bank_account_id = EXCLUDED.expected_bank_account_id,
          description = EXCLUDED.description,
          updated_at = now()
        WHERE ledger_revenue_entry.match_state = 'unmatched'
        RETURNING id`;
      if (res.length) {
        inserted++;
        insertedAmountBaht += toNum(b.totalAmount);
      }
    }
  } catch (e) {
    return {
      ok: false,
      inserted,
      insertedAmountBaht,
      alreadySent: 0,
      skippedForSlipMismatch,
      error: e instanceof Error ? e.message : "ส่งไม่สำเร็จ",
    };
  }

  return {
    ok: true,
    inserted,
    insertedAmountBaht,
    alreadySent: billsToSend.length - inserted,
    skippedForSlipMismatch,
  };
}

// CEO 2026-09-09 (Part C): CEO เจอ 4 บิลที่ยอดสลิปไม่ตรง จาก pre-send gate (evaluateBillSlipGate
// ด้านบน) แล้วขอให้ "โชว์เป็นสี/สัญลักษณ์ในตาราง" — ไม่ต้องกดปุ่มส่งก่อนถึงจะรู้. ต่างจาก
// pushProjectBillsToLedger ตรงที่ตัวนี้ต้อง "ถูกเรียกทุกครั้งที่โหลดหน้า matrix" (ทั้งหน้า)
// จึงห้ามยิง AI ใหม่เด็ดขาด — ใช้ ocrAmount ที่ persist ไว้แล้วเท่านั้น (ocrReadAt ต้องไม่ null)
// payment ที่ยังไม่เคยอ่านสลิปเลย (ocrReadAt null) ถูกตัดออกจาก query ตั้งแต่ต้น (ไม่ผ่าน
// evaluateBillSlipGate เลย) กัน false-positive แดงทั้งที่ "ยังไม่เคยตรวจ" — ต่างจาก "ตรวจแล้วไม่ตรง"
/** หาบิลที่ยอดสลิป (จาก ocrAmount ที่ AI เคยอ่านไว้แล้วเท่านั้น — ไม่เรียก AI ใหม่) ไม่ตรงกับ
 *  ยอดที่บันทึกไว้ — query เดียวต่อ billIds ทั้งหมด ไม่ N+1 (ใช้โหลดตาราง matrix ทั้งหน้า
 *  เหมือน getLedgerStatusForBills ด้านบน). reuse evaluateBillSlipGate() ตรงๆ (ไม่แก้ตัวมัน)
 *  แต่ป้อนเฉพาะ payment ที่ ocrReadAt ตั้งแล้ว — payment ที่ยังไม่ตรวจไม่ถูกนับเป็นเหตุผลเลย */
export async function getSlipMismatchBillIds(orgId: string, billIds: string[]): Promise<Set<string>> {
  if (billIds.length === 0) return new Set();
  const bills = await prisma.rentalBill.findMany({
    where: { id: { in: billIds }, orgId },
    select: {
      id: true,
      payments: {
        where: { status: "confirmed", slipUrl: { not: null }, ocrReadAt: { not: null } },
        select: { id: true, paidOn: true, slipUrl: true, amountThb: true, ocrAmount: true },
      },
    },
  });

  const mismatchIds = new Set<string>();
  for (const b of bills) {
    if (b.payments.length === 0) continue; // ไม่มี payment ที่ตรวจแล้วเลย — ยังไม่รู้ ไม่ใช่แดง
    const ocrAmountByPaymentId = new Map<string, number | null>(b.payments.map((p) => [p.id, p.ocrAmount]));
    if (evaluateBillSlipGate(b, ocrAmountByPaymentId).length > 0) mismatchIds.add(b.id);
  }
  return mismatchIds;
}

export type LedgerBillStatus = "not_sent" | "sent_unmatched" | "sent_matched";

/** สถานะส่งเข้าบัญชีต่อบิล — query เดียวต่อ billIds ทั้งหมด ไม่ N+1 (ใช้โหลดตาราง matrix) */
export async function getLedgerStatusForBills(
  orgId: string,
  billIds: string[],
): Promise<Map<string, LedgerBillStatus>> {
  if (billIds.length === 0) return new Map();
  const refs = billIds.map(sourceRef);
  const rows = await prisma.$queryRaw<{ source_ref: string; match_state: string }[]>`
    SELECT source_ref, match_state FROM ledger_revenue_entry
    WHERE org_id = ${orgId}::uuid AND source_type = 'RENTSPACE'
      AND source_ref = ANY(${refs})`;
  const stateByRef = new Map(rows.map((r) => [r.source_ref, r.match_state]));
  const out = new Map<string, LedgerBillStatus>();
  for (const id of billIds) {
    const state = stateByRef.get(sourceRef(id));
    out.set(id, state == null ? "not_sent" : state === "matched" ? "sent_matched" : "sent_unmatched");
  }
  return out;
}
