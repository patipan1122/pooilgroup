import "server-only";

import { prisma } from "@/lib/prisma";
import { decryptCredential } from "./crypto";

export type XsenseCreds = { apiId: string; apiKey: string };

// อ่านกุญแจ xsense: เช็คในเว็บ (FuelGpsConfig เข้ารหัส) ก่อน → ถ้าไม่มี ใช้ env เดิม
// (ของเดิมใช้ env FUELOS_XSENSE_API_ID/KEY — ยังทำงานได้ถ้าไม่ได้ตั้งในเว็บ)
export async function getXsenseCreds(): Promise<XsenseCreds | null> {
  try {
    const cfg = await prisma.fuelGpsConfig.findFirst({
      where: { enabled: true, apiIdEnc: { not: null }, apiKeyEnc: { not: null } },
      select: { apiIdEnc: true, apiKeyEnc: true },
    });
    if (cfg) {
      const apiId = decryptCredential(cfg.apiIdEnc);
      const apiKey = decryptCredential(cfg.apiKeyEnc);
      if (apiId && apiKey) return { apiId, apiKey };
    }
  } catch {
    // DB อ่านไม่ได้ → ตกไป env
  }
  const apiId = process.env.FUELOS_XSENSE_API_ID;
  const apiKey = process.env.FUELOS_XSENSE_API_KEY;
  if (apiId && apiKey) return { apiId, apiKey };
  return null;
}

// อ่านกุญแจของ "org นี้" โดยตรง (ใช้ในหน้า settings ตอนทดสอบ — ไม่ fallback env)
export async function getOrgXsenseCreds(orgId: string): Promise<XsenseCreds | null> {
  const cfg = await prisma.fuelGpsConfig.findUnique({
    where: { orgId },
    select: { apiIdEnc: true, apiKeyEnc: true },
  });
  const apiId = decryptCredential(cfg?.apiIdEnc);
  const apiKey = decryptCredential(cfg?.apiKeyEnc);
  if (apiId && apiKey) return { apiId, apiKey };
  return null;
}
