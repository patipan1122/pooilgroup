"use server";

// โครงการ (F2/F3) — read helper เฉพาะฝั่ง UI ที่ shared _actions.ts ยังไม่มี:
// "บิลที่แท็กโครงการนี้ + ยังไม่ผูกงวดไหน" (candidate สำหรับ MarkPaidSheet).
// company-scoped เสมอ (Pooil ≠ JPS · [[feedback-ledger-query-must-filter-companyid]]).
// อ่านอย่างเดียว + gate project.manage (ปุ่มปิดงวดเป็นสิทธิ์ผู้จัดการ) — ไม่แตะ GL/expense.

import { prisma } from "@/lib/prisma";
import { resolveLedgerActor, ledgerWebCan } from "@/lib/ledger/liff-auth";

export type LinkableExpense = {
  id: string;
  docCode: string | null;
  vendor: string | null;
  total: number;
  wht: number;
  /** เงินออกจริง = total − wht (ตรงกับ actualCashOut ของงวด). */
  cashOut: number;
  thumbUrl: string | null;
  originalUrl: string | null;
  docDate: Date | null;
};

/**
 * บิลของโครงการนี้ที่ "ติดป้ายแล้ว + ยังไม่ถูกผูกกับงวดใด" — ตัวเลือกให้กด "ปิดงวด (เขียว)".
 * exclude บิลที่เป็น anchor ของงวดอื่นอยู่แล้ว (paidExpenseId) + บิล void.
 * คืน [] ถ้าไม่มีสิทธิ์ (กันเผยข้อมูลบิลให้คนที่กดปิดงวดไม่ได้).
 */
export async function listLinkableExpensesAction(
  companyId: string,
  projectId: string,
): Promise<LinkableExpense[]> {
  const actor = await resolveLedgerActor();
  if (!actor || !(await ledgerWebCan(actor, "project.manage"))) return [];
  const orgId = actor.orgId;
  // company scope ต้องตรงกับ actor (กันข้ามบริษัท)
  if (actor.companyId && actor.companyId !== companyId) return [];

  // งวดที่ผูก anchor ไปแล้วในบริษัทนี้ → กันโชว์บิลที่ถูกจองแล้ว
  const linked = await prisma.ledgerInstallment.findMany({
    where: { orgId, companyId, projectId, paidExpenseId: { not: null } },
    select: { paidExpenseId: true },
  });
  const takenIds = linked
    .map((l) => l.paidExpenseId)
    .filter((x): x is string => !!x);

  const rows = await prisma.ledgerExpense.findMany({
    where: {
      orgId,
      companyId,
      projectId,
      status: { not: "void" },
      ...(takenIds.length ? { id: { notIn: takenIds } } : {}),
    },
    orderBy: [{ docDate: "desc" }, { createdAt: "desc" }],
    take: 100,
    select: {
      id: true,
      docCode: true,
      vendor: true,
      total: true,
      wht: true,
      thumbUrl: true,
      originalUrl: true,
      docDate: true,
    },
  });

  return rows.map((r) => {
    const total = Number(r.total);
    const wht = Number(r.wht);
    return {
      id: r.id,
      docCode: r.docCode,
      vendor: r.vendor,
      total,
      wht,
      cashOut: total - wht,
      thumbUrl: r.thumbUrl ?? null,
      originalUrl: r.originalUrl ?? null,
      docDate: r.docDate,
    };
  });
}
