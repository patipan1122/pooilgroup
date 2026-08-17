// RentSpace → LedgerLine bridge: ส่งยอดบิลที่ "จ่ายครบ" เข้า ledger_revenue_entry
// เพื่อรอจับคู่กับ statement ธนาคารจริง (bank-recon) — pattern เดียวกับ
// lib/chairops/reconcile/ledger-push.ts (CEO 2026-08-15): source_type
// discriminator + deterministic source_ref + INSERT...ON CONFLICT WHERE
// match_state='unmatched' (กันส่งซ้ำ อะตอมมิก · กดกี่ครั้งก็ได้ · ไม่แตะรายการ
// ที่จับคู่แล้ว). 'RENTSPACE' อยู่ใน source_type CHECK ของ ledger_revenue_entry
// ตั้งแต่ migration แรก — ไม่ต้องแก้ schema ฝั่ง ledger เลย.
import { prisma } from "@/lib/prisma";
import { toNum, tenantDisplayName, periodLabel, PAYMENT_METHODS } from "@/lib/rentspace/format";

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

export type PushResult = {
  ok: boolean;
  inserted: number;
  alreadySent: number;
  error?: string;
};

/** ส่งบิล "จ่ายครบ" ทั้งหมดของโครงการเข้า ledger_revenue_entry — กดซ้ำได้ไม่จำกัด
 *  source_ref ผูกกับ billId เสมอ ทำให้ ON CONFLICT กันซ้ำอัตโนมัติในระดับฐานข้อมูล
 *  (แถวที่จับคู่ statement แล้วจะไม่ถูกแตะ) */
export async function pushProjectBillsToLedger(orgId: string, projectId: string): Promise<PushResult> {
  const project = await prisma.rentalProject.findFirst({
    where: { id: projectId, orgId },
    select: { name: true, companyId: true, reconcileBankAccountId: true },
  });
  if (!project) return { ok: false, inserted: 0, alreadySent: 0, error: "ไม่พบโครงการ" };
  if (!project.companyId || !project.reconcileBankAccountId) {
    return {
      ok: false,
      inserted: 0,
      alreadySent: 0,
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
        take: 1,
        select: { paidOn: true, method: true },
      },
    },
  });

  if (bills.length === 0) return { ok: true, inserted: 0, alreadySent: 0 };

  let inserted = 0;
  try {
    for (const b of bills) {
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
      if (res.length) inserted++;
    }
  } catch (e) {
    return { ok: false, inserted, alreadySent: 0, error: e instanceof Error ? e.message : "ส่งไม่สำเร็จ" };
  }

  return { ok: true, inserted, alreadySent: bills.length - inserted };
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
