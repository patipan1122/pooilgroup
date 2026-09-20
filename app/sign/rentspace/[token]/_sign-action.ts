"use server";

import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";
import { resolveContractBody } from "@/lib/rentspace/contract-doc";
import { rateLimit, LIMITS } from "@/lib/chairops/utils/rate-limit";

// ลิงก์เซ็นที่ไม่ถูกใช้นานเกินนี้ถือว่าหมดอายุ — กันลิงก์เก่า/หลุดถูกเอาไปเซ็นย้อนหลัง (P1 security)
const SIGN_LINK_MAX_AGE_DAYS = 90;

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
  // Public, unauthenticated, token-gated write — rate-limit per sign token so
  // this endpoint can't be scripted/hammered against one link (P1 security).
  const rl = rateLimit(`rs-sign:${input.token}`, LIMITS.posUpload);
  if (!rl.ok) throw new Error("ลองใหม่ภายหลัง · เร็วเกินไป");

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

  // ── token-expiry check (P1 security) ──
  // RentalContract ไม่มี field เฉพาะสำหรับวันหมดอายุ signToken (เช่น signTokenExpiresAt) — เพิ่มไม่ได้
  // ในรอบนี้ (schema migration ต้องประสานแยก). ใช้ updatedAt แทนเป็น proxy ที่ใกล้เคียงที่สุดที่มีอยู่แล้ว
  // เพราะทุกจุดที่ออก/รีเจนใหม่ signToken (actGenerateSignLink · ออก addendum ตอนแก้สัญญาที่เซ็นแล้ว ·
  // อนุมัติคำขอแก้ไขสัญญา — ดู app/(admin)/rentspace/_actions.ts) ล้วนเรียก prisma.rentalContract.update()
  // ซึ่ง Prisma bump updatedAt (@updatedAt) ให้อัตโนมัติเสมอ ณ เวลาเดียวกับที่ token ใหม่ถูกออก
  // ข้อจำกัดที่รู้: ถ้ามีคนแก้ contract เรื่องอื่นที่ไม่เกี่ยวกับ token (เช่นแก้บิลลิ่ง) หลังออก token แล้ว
  // updatedAt จะขยับตาม ทำให้ token เก่าดูใหม่กว่าความจริง — ควรเพิ่ม signTokenExpiresAt เป็น field จริง
  // ในอนาคตเพื่อความแม่นยำ 100%
  const tokenAgeMs = Date.now() - contract.updatedAt.getTime();
  const maxAgeMs = SIGN_LINK_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  if (tokenAgeMs > maxAgeMs) {
    throw new Error("ลิงก์เซ็นสัญญานี้หมดอายุแล้ว กรุณาติดต่อผู้ดูแลระบบเพื่อขอลิงก์เซ็นใหม่");
  }

  // ── capture IP + user-agent for the audit trail (P1 legal defensibility) ──
  // public route ไม่มี session ให้ดึง IP ทางอื่น — อ่านจาก request header ตรง ๆ
  // (pattern เดียวกับ app/(admin)/chairops/(maid)/m/contract/actions.ts:signContract)
  const hdrs = await headers();
  const forwardedFor = hdrs.get("x-forwarded-for");
  const ipAddress = forwardedFor?.split(",")[0]?.trim() || hdrs.get("x-real-ip")?.trim() || undefined;
  const userAgent = hdrs.get("user-agent")?.slice(0, 500) ?? undefined;

  // "ล็อกฉบับเซ็น" — snapshot ข้อความสัญญา "ที่เติมค่าแล้ว" ณ วันเซ็น ลง customTermsHtml เสมอ
  // (แม้ customTermsHtml เดิมจะเป็นแม่แบบดิบที่ยังมี {{ตัวแปร}} — ถ้าไม่เติมแล้วเก็บ จะ re-fill ค่าใหม่ทุกครั้งที่ render
  //  ทำให้เอกสารที่เซ็นแล้วโชว์เงื่อนไขที่เปลี่ยนภายหลัง = ไม่ตรงที่ลูกค้าเซ็น). resolveContractBody เติมค่าจาก
  //  customTermsHtml > template > v3 ให้อยู่แล้ว · ถ้าเติมแล้ว (redline/ว่าง) = no-op ปลอดภัย
  const frozenBody = resolveContractBody(contract) || null;

  // ── atomic guard against double-submit race (P1 correctness) ──
  // เดิม findUnique อ่านแล้วค่อย update แยก step (TOCTOU) — สอง request พร้อมกัน (double-tap มือถือ/
  // ส่งซ้ำ) อาจผ่านเช็ค tenantSigned ด้านบนพร้อมกันทั้งคู่ แล้วยิง update ทับกันทั้งคู่. ใช้ idiom เดียวกับ
  // actConfirmTenantPayment ใน app/(admin)/rentspace/_actions.ts: updateMany มี WHERE guard
  // (tenantSigned: false) แล้วเช็ค count === 0 = มีคนเซ็นไปก่อนแล้วในช่วงเสี้ยววินาทีนี้ → reject การส่งซ้ำนี้
  // ไม่ silently ทับ/re-process
  await prisma.$transaction(async (tx) => {
    const flipped = await tx.rentalContract.updateMany({
      where: { id: contract.id, tenantSigned: false },
      data: {
        tenantSigned: true,
        signedAt: new Date(),
        signerName,
        signatureDataUrl: input.signatureDataUrl,
        status: "active",
        ...(frozenBody ? { customTermsHtml: frozenBody } : {}),
      },
    });
    if (flipped.count === 0) {
      throw new Error("สัญญานี้ถูกเซ็นไปแล้ว กรุณารีเฟรชหน้าเพื่อดูผล");
    }
    // เมื่อเซ็นแล้ว = สัญญามีผล → ห้องมีผู้เช่า
    await tx.rentalUnit.update({
      where: { id: contract.unitId },
      data: { status: "occupied" },
    });
  });

  await audit({
    orgId: contract.orgId,
    userId: null,
    action: "RENTSPACE_CONTRACT_SIGNED",
    resourceType: "rental_contract",
    resourceId: contract.id,
    diff: { new: { signerName } },
    ipAddress,
    userAgent,
  });

  return { ok: true };
}
