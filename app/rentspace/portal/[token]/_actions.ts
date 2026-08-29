"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getTenantByPortalToken, uploadPortalSlip } from "@/lib/rentspace/portal";
import { runRentSpaceSlipCheck } from "@/lib/rentspace/slip-check";

// ทุก action ตรวจ token → ผู้เช่า ใหม่ทุกครั้ง · ไม่เชื่อ id ที่ client ส่งมาลอย ๆ
async function tenantFromToken(token: string) {
  const tenant = await getTenantByPortalToken(token);
  if (!tenant) throw new Error("ลิงก์ไม่ถูกต้องหรือถูกยกเลิกแล้ว");
  return tenant;
}

/**
 * ผู้เช่าแจ้งชำระ + แนบสลิป → สร้าง payment สถานะ "pending" (รอแอดมินตรวจ).
 * ⚠️ ไม่แตะ bill.paidAmount — ยอดขยับตอนแอดมินกดยืนยันเท่านั้น (money-safe).
 */
export async function actPortalSubmitSlip(input: {
  token: string;
  billId: string;
  amountThb: number;
  paidOn: string;
  slipDataUrl: string;
  note?: string;
}) {
  const tenant = await tenantFromToken(input.token);
  // บิลต้องเป็นของผู้เช่าคนนี้จริง (กันเดา billId ข้ามคน)
  const bill = await prisma.rentalBill.findFirst({
    where: { id: input.billId, tenantId: tenant.id, orgId: tenant.orgId },
    select: { id: true, projectId: true, contractId: true, status: true },
  });
  if (!bill) throw new Error("ไม่พบบิลนี้ หรือไม่ใช่บิลของคุณ");
  if (bill.status === "void") throw new Error("บิลนี้ถูกยกเลิกแล้ว");

  const amount = Math.round(Number(input.amountThb) * 100) / 100;
  if (!(amount > 0)) throw new Error("จำนวนเงินต้องมากกว่า 0");
  if (!input.slipDataUrl) throw new Error("กรุณาแนบสลิปโอนเงิน");

  // กันส่งซ้ำ (กดรัว/รีเฟรช): บิล+ยอด ที่ยัง pending ภายใน 3 นาที = ซ้ำ
  const dupSince = new Date(Date.now() - 180_000);
  const dup = await prisma.rentalPayment.findFirst({
    where: { billId: bill.id, source: "tenant", status: "pending", amountThb: amount, createdAt: { gte: dupSince } },
    select: { id: true },
  });
  if (dup) return { ok: true, deduped: true };

  const slipUrl = await uploadPortalSlip(tenant.orgId, input.slipDataUrl);
  const paymentId = randomUUID();
  await prisma.rentalPayment.create({
    data: {
      id: paymentId,
      orgId: tenant.orgId,
      billId: bill.id,
      contractId: bill.contractId,
      amountThb: amount,
      paidOn: new Date(input.paidOn || new Date().toISOString().slice(0, 10)),
      method: "transfer",
      slipUrl,
      note: input.note?.trim() || null,
      status: "pending", // รอแอดมินตรวจ
      source: "tenant",
      receivedBy: null,
    },
  });
  // AI อ่านสลิป + ตรวจซ้ำ/บัญชีผิด — ผู้เช่าอัปโหลดเองก็ตรวจเหมือนพนักงานบันทึก (CEO 2026-08-29: ตรวจทั้งสองทาง)
  // แอดมินยังต้องกดยืนยัน (status=pending) เหมือนเดิม — ผลตรวจ AI แค่ช่วยให้เห็นธงตอนตรวจ ไม่ auto-approve เงิน
  await runRentSpaceSlipCheck({
    orgId: tenant.orgId,
    projectId: bill.projectId,
    contractId: bill.contractId,
    paymentId,
    slipUrl,
    actor: { userId: tenant.id, orgId: tenant.orgId },
  });
  revalidatePath("/rentspace/payments");
  revalidatePath("/rentspace/bills");
  revalidatePath("/rentspace");
  return { ok: true };
}

/** ผู้เช่าบันทึกอีเมล + เปิด/ปิดรับบิลทางอีเมล */
export async function actPortalSaveEmail(input: { token: string; email: string; optIn: boolean }) {
  const tenant = await tenantFromToken(input.token);
  const email = (input.email || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("อีเมลไม่ถูกต้อง");
  await prisma.rentalTenant.update({
    where: { id: tenant.id },
    data: { email: email || null, emailBillOptIn: email ? !!input.optIn : false },
  });
  return { ok: true, email: email || null, optIn: email ? !!input.optIn : false };
}
