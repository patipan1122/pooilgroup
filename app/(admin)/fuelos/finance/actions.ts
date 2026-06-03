"use server";

import { revalidatePath } from "next/cache";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireUser, atLeast } from "@/lib/fuelos/auth";
import { audit } from "@/lib/fuelos/audit";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { PaymentMethod } from "@/lib/generated/prisma/enums";

type Result = { ok: true } | { ok: false; error: string };

// การเงินเท่านั้นถึงจะแก้ยอดได้ (กันเซลล์มากดยืนยันเอง)
async function requireFinance() {
  const user = await requireUser();
  if (!atLeast(user.role, "FINANCE")) {
    throw new Error("ต้องเป็นฝ่ายการเงินขึ้นไป");
  }
  return user;
}

function refresh() {
  revalidatePath("/fuelos/finance");
}

// ---------- helper: ปรับยอดใช้เครดิตของลูกค้าอย่างปลอดภัย ----------
// ใช้ใน $transaction เสมอ (ส่ง tx client เข้ามา) → ยอดเครดิตห้ามเพี้ยน
// ลด: clamp ไม่ให้ติดลบ (ถ้า reduce เกินยอดจริง เหลือ 0)
async function reduceCreditUsed(
  tx: Prisma.TransactionClient,
  orgId: string,
  customerId: string,
  amount: number,
) {
  const c = await tx.customer.findFirst({
    where: { id: customerId, orgId },
    select: { creditUsed: true },
  });
  if (!c) return;
  const next = Math.max(0, Number(c.creditUsed) - amount);
  await tx.customer.updateMany({ where: { id: customerId, orgId }, data: { creditUsed: next } });
}

async function increaseCreditUsed(
  tx: Prisma.TransactionClient,
  orgId: string,
  customerId: string,
  amount: number,
) {
  await tx.customer.updateMany({
    where: { id: customerId, orgId },
    data: { creditUsed: { increment: amount } },
  });
}

// ============================================================
// PAYMENTS
// ============================================================

// บันทึกรับชำระ → สร้าง Payment สถานะ PENDING (รอการเงินยืนยันยอดเข้าจริง)
export async function recordPayment(formData: FormData): Promise<Result> {
  const user = await requireFinance();

  const customerId = String(formData.get("customerId") ?? "").trim();
  const amount = Number(formData.get("amount") ?? 0);
  const method = String(formData.get("method") ?? "TRANSFER") as PaymentMethod;
  const paymentDate = String(formData.get("paymentDate") ?? "").trim();
  const reference = String(formData.get("reference") ?? "").trim();

  if (!customerId) return { ok: false, error: "เลือกลูกค้าก่อน" };
  if (!(amount > 0)) return { ok: false, error: "ยอดเงินต้องมากกว่า 0" };
  if (!paymentDate) return { ok: false, error: "ระบุวันที่รับชำระ" };

  // ยืนยันว่าลูกค้าอยู่ใน org เดียวกัน (กัน cross-org)
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, orgId: user.orgId },
    select: { id: true },
  });
  if (!customer) return { ok: false, error: "ไม่พบลูกค้า" };

  // กันสลิปซ้ำ: hash จาก reference (ถ้ามี) — slipHash unique ต่อ org
  const slipHash = reference
    ? createHash("sha256").update(`${user.orgId}:${reference.toLowerCase()}`).digest("hex")
    : null;

  if (slipHash) {
    const dup = await prisma.payment.findFirst({
      where: { orgId: user.orgId, slipHash },
      select: { id: true },
    });
    if (dup) return { ok: false, error: "อ้างอิง/สลิปนี้ถูกบันทึกไปแล้ว (กันซ้ำ)" };
  }

  let p;
  try {
    p = await prisma.payment.create({
      data: {
        orgId: user.orgId,
        customerId,
        amount,
        method,
        paymentDate: new Date(paymentDate),
        reference: reference || null,
        slipHash,
        status: "PENDING",
        createdById: user.id,
      },
    });
  } catch (e) {
    // unique slipHash ชน (กันซ้ำระดับ DB เผื่อ race หลุด pre-check)
    if ((e as { code?: string })?.code === "P2002") {
      return { ok: false, error: "อ้างอิง/สลิปนี้ถูกบันทึกไปแล้ว (กันซ้ำ)" };
    }
    throw e;
  }

  await audit({
    orgId: user.orgId,
    userId: user.id,
    action: "PAYMENT_RECORD",
    entity: "Payment",
    entityId: p.id,
    meta: { customerId, amount, method, reference: reference || null },
  });
  refresh();
  return { ok: true };
}

// ยืนยันยอดเข้าจริง → VERIFIED + ลดยอดใช้เครดิตของลูกค้า (ถ้ามียอด)
// ทั้งหมดอยู่ใน transaction เดียว → ยอดเครดิตกับสถานะ payment สอดคล้องกันเสมอ
export async function verifyPayment(id: string): Promise<Result> {
  const user = await requireFinance();

  const payment = await prisma.payment.findFirst({
    where: { id, orgId: user.orgId },
    select: { id: true, status: true, customerId: true, amount: true },
  });
  if (!payment) return { ok: false, error: "ไม่พบรายการรับชำระ" };
  if (payment.status !== "PENDING") return { ok: false, error: "รายการนี้ถูกดำเนินการแล้ว" };

  const amount = Number(payment.amount);

  await prisma.$transaction(async (tx) => {
    // flip สถานะแบบมีเงื่อนไข → ลดเครดิตเฉพาะเมื่อแถวเปลี่ยนจริง (กัน double-reduce จาก race)
    const r = await tx.payment.updateMany({
      where: { id, orgId: user.orgId, status: "PENDING" },
      data: { status: "VERIFIED", verifiedById: user.id, verifiedAt: new Date() },
    });
    if (r.count === 1) await reduceCreditUsed(tx, user.orgId, payment.customerId, amount);
  });

  await audit({
    orgId: user.orgId,
    userId: user.id,
    action: "PAYMENT_VERIFY",
    entity: "Payment",
    entityId: id,
    meta: { customerId: payment.customerId, amount },
  });
  refresh();
  return { ok: true };
}

// ปฏิเสธยอด (สลิปไม่ตรง/เงินไม่เข้า) → REJECTED, ไม่แตะเครดิต
export async function rejectPayment(id: string): Promise<Result> {
  const user = await requireFinance();

  const payment = await prisma.payment.findFirst({
    where: { id, orgId: user.orgId },
    select: { id: true, status: true, customerId: true, amount: true },
  });
  if (!payment) return { ok: false, error: "ไม่พบรายการรับชำระ" };
  if (payment.status !== "PENDING") return { ok: false, error: "รายการนี้ถูกดำเนินการแล้ว" };

  await prisma.payment.updateMany({
    where: { id, orgId: user.orgId, status: "PENDING" },
    data: { status: "REJECTED", verifiedById: user.id, verifiedAt: new Date() },
  });

  await audit({
    orgId: user.orgId,
    userId: user.id,
    action: "PAYMENT_REJECT",
    entity: "Payment",
    entityId: id,
    meta: { customerId: payment.customerId, amount: Number(payment.amount) },
  });
  refresh();
  return { ok: true };
}

// ============================================================
// CHEQUES
// ============================================================

// เพิ่มเช็ครับเข้า → PENDING (รอวันถึงกำหนด/ขึ้นเงิน)
export async function addCheque(formData: FormData): Promise<Result> {
  const user = await requireFinance();

  const customerId = String(formData.get("customerId") ?? "").trim();
  const chequeNumber = String(formData.get("chequeNumber") ?? "").trim();
  const bank = String(formData.get("bank") ?? "").trim();
  const amount = Number(formData.get("amount") ?? 0);
  const dueDate = String(formData.get("dueDate") ?? "").trim();

  if (!customerId) return { ok: false, error: "เลือกลูกค้าก่อน" };
  if (!chequeNumber) return { ok: false, error: "ระบุเลขที่เช็ค" };
  if (!bank) return { ok: false, error: "ระบุธนาคาร" };
  if (!(amount > 0)) return { ok: false, error: "ยอดเงินต้องมากกว่า 0" };
  if (!dueDate) return { ok: false, error: "ระบุวันที่ถึงกำหนด" };

  const customer = await prisma.customer.findFirst({
    where: { id: customerId, orgId: user.orgId },
    select: { id: true },
  });
  if (!customer) return { ok: false, error: "ไม่พบลูกค้า" };

  const ch = await prisma.cheque.create({
    data: {
      orgId: user.orgId,
      customerId,
      chequeNumber,
      bank,
      amount,
      dueDate: new Date(dueDate),
      status: "PENDING",
    },
  });

  await audit({
    orgId: user.orgId,
    userId: user.id,
    action: "CHEQUE_ADD",
    entity: "Cheque",
    entityId: ch.id,
    meta: { customerId, chequeNumber, bank, amount },
  });
  refresh();
  return { ok: true };
}

// ขึ้นเงินสำเร็จ → CLEARED + ลดยอดใช้เครดิต (เงินเข้าจริงแล้ว)
export async function clearCheque(id: string): Promise<Result> {
  const user = await requireFinance();

  const cheque = await prisma.cheque.findFirst({
    where: { id, orgId: user.orgId },
    select: { id: true, status: true, customerId: true, amount: true },
  });
  if (!cheque) return { ok: false, error: "ไม่พบเช็ค" };
  if (cheque.status !== "PENDING") return { ok: false, error: "เช็คนี้ถูกดำเนินการแล้ว" };

  const amount = Number(cheque.amount);

  await prisma.$transaction(async (tx) => {
    const r = await tx.cheque.updateMany({
      where: { id, orgId: user.orgId, status: "PENDING" },
      data: { status: "CLEARED", clearedAt: new Date() },
    });
    if (r.count === 1) await reduceCreditUsed(tx, user.orgId, cheque.customerId, amount);
  });

  await audit({
    orgId: user.orgId,
    userId: user.id,
    action: "CHEQUE_CLEAR",
    entity: "Cheque",
    entityId: id,
    meta: { customerId: cheque.customerId, amount },
  });
  refresh();
  return { ok: true };
}

// เช็คเด้ง → BOUNCED + คืนยอดใช้เครดิตกลับ (ลูกค้ายังเป็นหนี้อยู่)
export async function bounceCheque(id: string, reason?: string): Promise<Result> {
  const user = await requireFinance();

  const cheque = await prisma.cheque.findFirst({
    where: { id, orgId: user.orgId },
    select: { id: true, status: true, customerId: true, amount: true },
  });
  if (!cheque) return { ok: false, error: "ไม่พบเช็ค" };
  if (cheque.status === "BOUNCED") return { ok: false, error: "เช็คนี้ถูกบันทึกว่าเด้งแล้ว" };

  const amount = Number(cheque.amount);
  const wasCleared = cheque.status === "CLEARED";

  await prisma.$transaction(async (tx) => {
    const r = await tx.cheque.updateMany({
      where: { id, orgId: user.orgId, status: { not: "BOUNCED" } },
      data: { status: "BOUNCED", bouncedReason: reason?.trim() || null, clearedAt: null },
    });
    // คืนเครดิตเฉพาะเมื่อ "เคย CLEARED (เคยลดไปแล้ว)" และแถวเพิ่งเปลี่ยนเป็น BOUNCED จริง
    if (r.count === 1 && wasCleared) {
      await increaseCreditUsed(tx, user.orgId, cheque.customerId, amount);
    }
  });

  await audit({
    orgId: user.orgId,
    userId: user.id,
    action: "CHEQUE_BOUNCE",
    entity: "Cheque",
    entityId: id,
    meta: { customerId: cheque.customerId, amount, reason: reason ?? null, restoredCredit: wasCleared },
  });
  refresh();
  return { ok: true };
}
