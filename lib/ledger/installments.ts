import "server-only";
import { prisma } from "@/lib/prisma";

// LedgerLine — งวดงาน (progress payment · F3) read helpers. company-scoped เสมอ.
// กฎเหล็ก: 'paid' ต้องมี anchor จริง (paidExpenseId ที่ยังติดโครงการนี้) — ไม่งั้น compute เป็น
// 'broken' (สลิปหลุด/ตรวจสอบ) ไม่ปล่อยเขียวลอย. actualCashOut = anchor.total − anchor.wht (ยอดจ่ายจริง).

export type InstallmentDisplayStatus =
  | "planned"
  | "paid_pending_slip" // amber — จ่ายแล้วรอสลิป
  | "paid" // green — ผูก anchor จริง
  | "broken" // anchor หลุด/ถอดโครงการ → ต้องตรวจ
  | "void";

export type LedgerInstallmentRow = {
  id: string;
  seq: number;
  label: string;
  vendorLabel: string | null;
  dueDate: Date | null;
  plannedAmount: number; // ยอดสัญญา (gross)
  status: InstallmentDisplayStatus;
  paidExpenseId: string | null;
  paidPaymentRequestId: string | null;
  paidAt: Date | null;
  slipThumbUrl: string | null;
  slipOriginalUrl: string | null;
  /** โอนจริง = anchor.total − anchor.wht (เงินออกจริง) · null ถ้าไม่มี anchor. */
  actualCashOut: number | null;
};

export type ProjectInstallmentSummary = {
  rows: LedgerInstallmentRow[];
  plannedTotal: number; // Σ plannedAmount ทุกงวด
  paidTrustedTotal: number; // Σ โอนจริง เฉพาะงวด green (นับได้จริง)
  amberCount: number; // งวด "จ่ายแล้ว—รอสลิป" (ยังไม่นับ trusted)
  brokenCount: number; // งวดที่ anchor หลุด
  paidPlannedTotal: number; // Σ ยอดสัญญาของงวดที่จ่ายจริง (green)
  retentionHeld: number; // เงินประกันคงค้าง = retentionPct% × paidPlannedTotal (P2 · display-only)
};

export async function listLedgerInstallments(
  orgId: string,
  companyId: string,
  projectId: string,
  retentionPct = 0, // % เงินประกันผลงาน (จาก LedgerProject · P2)
): Promise<ProjectInstallmentSummary> {
  const rows = await prisma.ledgerInstallment.findMany({
    where: { orgId, companyId, projectId },
    orderBy: [{ seq: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      seq: true,
      label: true,
      vendorLabel: true,
      dueDate: true,
      plannedAmount: true,
      status: true,
      paidExpenseId: true,
      paidPaymentRequestId: true,
      paidAt: true,
    },
  });

  // ดึง anchor expenses (broken-detection + สลิป + ยอดจ่ายจริง)
  const expIds = rows.map((r) => r.paidExpenseId).filter((x): x is string => !!x);
  const exps = expIds.length
    ? await prisma.ledgerExpense.findMany({
        where: { id: { in: expIds }, orgId, companyId },
        select: { id: true, projectId: true, thumbUrl: true, originalUrl: true, total: true, wht: true, status: true },
      })
    : [];
  const expById = new Map(exps.map((e) => [e.id, e]));

  // ดึง payment requests (งวดที่ขอโอนตรง · P2-B) — สถานะงวดแท้ = ตาม request.state · สลิปจาก LedgerPayment
  const reqIds = rows.map((r) => r.paidPaymentRequestId).filter((x): x is string => !!x);
  const reqs = reqIds.length
    ? await prisma.ledgerPaymentRequest.findMany({
        where: { id: { in: reqIds }, orgId, companyId },
        select: {
          id: true,
          state: true,
          paidTotal: true,
          payments: { select: { slipUrl: true, slipThumbUrl: true }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      })
    : [];
  const reqById = new Map(reqs.map((q) => [q.id, q]));

  let plannedTotal = 0;
  let paidTrustedTotal = 0;
  let paidPlannedTotal = 0;
  let amberCount = 0;
  let brokenCount = 0;

  const out: LedgerInstallmentRow[] = rows.map((r) => {
    plannedTotal += Number(r.plannedAmount);
    let status = r.status as InstallmentDisplayStatus;
    let slipThumbUrl: string | null = null;
    let slipOriginalUrl: string | null = null;
    let actualCashOut: number | null = null;

    if (r.paidPaymentRequestId) {
      // ขอโอนตรงจากงวด (P2-B): สถานะงวดแท้ = ตาม request state (DB งวดค้าง amber ตั้งแต่ตอนขอ ·
      // ไม่มี hook อัปเดตงวดตอนสลิปเข้า → อ่านจาก request เป็น single-source-of-truth)
      const q = reqById.get(r.paidPaymentRequestId);
      if (!q || q.state === "cancelled" || q.state === "reversed" || q.state === "abnormal") {
        status = "broken";
      } else if (q.state === "paid") {
        status = "paid";
        const slip = q.payments[0];
        slipThumbUrl = slip?.slipThumbUrl ?? null;
        slipOriginalUrl = slip?.slipUrl ?? null;
        actualCashOut = Number(q.paidTotal);
        paidTrustedTotal += actualCashOut;
        paidPlannedTotal += Number(r.plannedAmount);
      } else {
        // open/partial → ยังไม่โอนจริง (รอสลิป) → amber "ขอโอนแล้ว—รอโอน"
        status = "paid_pending_slip";
      }
    } else if (r.status === "paid") {
      if (r.paidExpenseId) {
        const e = expById.get(r.paidExpenseId);
        // co-membership invariant: anchor ต้องยังติดโครงการนี้ + ไม่ void
        if (!e || e.projectId !== projectId || e.status === "void") {
          status = "broken";
        } else {
          slipThumbUrl = e.thumbUrl ?? null;
          slipOriginalUrl = e.originalUrl ?? null;
          actualCashOut = Number(e.total) - Number(e.wht);
          paidTrustedTotal += actualCashOut;
          paidPlannedTotal += Number(r.plannedAmount); // ฐานคิดเงินประกัน = ยอดสัญญาของงวดที่จ่ายจริง
        }
      } else {
        // paid แต่ไม่มี anchor ทั้ง 2 ทาง (เช่น บิลเงินสดถูก hard-delete → FK SET NULL) →
        // ห้ามค้างเขียวหลอก · ดาวน์เกรดเป็น broken ให้คนไปตรวจ
        status = "broken";
      }
    }
    if (status === "paid_pending_slip") amberCount += 1;
    if (status === "broken") brokenCount += 1;

    return {
      id: r.id,
      seq: r.seq,
      label: r.label,
      vendorLabel: r.vendorLabel,
      dueDate: r.dueDate,
      plannedAmount: Number(r.plannedAmount),
      status,
      paidExpenseId: r.paidExpenseId,
      paidPaymentRequestId: r.paidPaymentRequestId,
      paidAt: r.paidAt,
      slipThumbUrl,
      slipOriginalUrl,
      actualCashOut,
    };
  });

  // เงินประกันคงค้าง = % × ยอดสัญญาของงวดที่จ่ายจริง (ปัดทศนิยม 2) · display-only ไม่มี engine คืน
  const retentionHeld = Math.round(((retentionPct || 0) / 100) * paidPlannedTotal * 100) / 100;
  return { rows: out, plannedTotal, paidTrustedTotal, amberCount, brokenCount, paidPlannedTotal, retentionHeld };
}
