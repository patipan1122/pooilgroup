"use server";

import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";

/**
 * Public e-sign action — no admin session required.
 * ผู้เช่าเปิดลิงก์เซ็นสัญญาออนไลน์ → วาดลายเซ็น → ยอมรับ
 * เก็บภาพลายเซ็น + เวลา + ชื่อผู้เซ็น (e-sign ระดับพอเหมาะ ไม่ต้อง digital cert)
 */
export async function actSignContract(input: {
  token: string;
  signerName: string;
  signatureDataUrl: string;
}): Promise<{ ok: boolean }> {
  const signerName = (input.signerName ?? "").trim();
  if (!signerName) throw new Error("กรุณากรอกชื่อผู้เซ็น");
  if (!/^data:image\/(png|jpeg|jpg);base64,/.test(input.signatureDataUrl)) {
    throw new Error("ลายเซ็นไม่ถูกต้อง");
  }

  const contract = await prisma.rentalContract.findUnique({
    where: { signToken: input.token },
    select: { id: true, orgId: true, unitId: true, tenantSigned: true, status: true },
  });
  if (!contract) throw new Error("ไม่พบสัญญา");
  if (contract.tenantSigned) {
    // idempotent — already signed, no double-write
    return { ok: true };
  }
  // a terminated/expired contract must not be re-activated via an old sign link
  if (contract.status === "terminated" || contract.status === "expired") {
    throw new Error("สัญญานี้สิ้นสุดแล้ว ไม่สามารถเซ็นได้");
  }

  await prisma.rentalContract.update({
    where: { id: contract.id },
    data: {
      tenantSigned: true,
      signedAt: new Date(),
      signerName,
      signatureDataUrl: input.signatureDataUrl,
      status: "active",
    },
  });
  // เมื่อเซ็นแล้ว = สัญญามีผล → ห้องมีผู้เช่า
  await prisma.rentalUnit.update({
    where: { id: contract.unitId },
    data: { status: "occupied" },
  });

  await audit({
    orgId: contract.orgId,
    userId: null,
    action: "RENTSPACE_CONTRACT_SIGNED",
    resourceType: "rental_contract",
    resourceId: contract.id,
    diff: { new: { signerName } },
  });

  return { ok: true };
}
