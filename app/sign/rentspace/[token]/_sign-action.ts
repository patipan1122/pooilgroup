"use server";

import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";
import { resolveContractBody } from "@/lib/rentspace/contract-doc";

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
    include: {
      unit: true,
      tenant: true,
      project: true,
      template: true,
      recurringCharges: { where: { isActive: true }, orderBy: { sort: "asc" } },
    },
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

  // "ล็อกฉบับเซ็น" — snapshot ข้อความสัญญา "ที่เติมค่าแล้ว" ณ วันเซ็น ลง customTermsHtml เสมอ
  // (แม้ customTermsHtml เดิมจะเป็นแม่แบบดิบที่ยังมี {{ตัวแปร}} — ถ้าไม่เติมแล้วเก็บ จะ re-fill ค่าใหม่ทุกครั้งที่ render
  //  ทำให้เอกสารที่เซ็นแล้วโชว์เงื่อนไขที่เปลี่ยนภายหลัง = ไม่ตรงที่ลูกค้าเซ็น). resolveContractBody เติมค่าจาก
  //  customTermsHtml > template > v3 ให้อยู่แล้ว · ถ้าเติมแล้ว (redline/ว่าง) = no-op ปลอดภัย
  const frozenBody = resolveContractBody(contract) || null;

  await prisma.rentalContract.update({
    where: { id: contract.id },
    data: {
      tenantSigned: true,
      signedAt: new Date(),
      signerName,
      signatureDataUrl: input.signatureDataUrl,
      status: "active",
      ...(frozenBody ? { customTermsHtml: frozenBody } : {}),
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
