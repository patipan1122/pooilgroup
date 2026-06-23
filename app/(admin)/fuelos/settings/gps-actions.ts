"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, atLeast } from "@/lib/fuelos/auth";
import { audit } from "@/lib/fuelos/audit";
import { encryptCredential } from "@/lib/fuelos/gps/crypto";
import { getOrgXsenseCreds } from "@/lib/fuelos/gps/creds";
import { getXsenseStatus } from "@/lib/fuelos/gps/xsense";

async function requireAdmin() {
  const user = await requireUser();
  if (!atLeast(user.role, "ADMIN")) throw new Error("ต้องเป็นแอดมินขึ้นไปจึงจะตั้งค่า GPS ได้");
  return user;
}

// บันทึกคีย์ + การตั้งค่า (เว้นว่าง = คงคีย์เดิม)
export async function upsertGpsConfig(formData: FormData) {
  const user = await requireAdmin();
  const apiId = String(formData.get("apiId") ?? "").trim();
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const enabled = formData.get("enabled") === "on" || formData.get("enabled") === "true";
  const groupsRaw = String(formData.get("trackedGroups") ?? "").trim();
  const trackedGroups =
    !groupsRaw || groupsRaw.toUpperCase() === "ALL"
      ? ["ALL"]
      : groupsRaw.split(",").map((g) => g.trim()).filter(Boolean);

  await prisma.fuelGpsConfig.upsert({
    where: { orgId: user.orgId },
    create: {
      orgId: user.orgId,
      apiIdEnc: apiId ? encryptCredential(apiId) : null,
      apiKeyEnc: apiKey ? encryptCredential(apiKey) : null,
      enabled,
      trackedGroups,
    },
    update: {
      enabled,
      trackedGroups,
      ...(apiId ? { apiIdEnc: encryptCredential(apiId) } : {}),
      ...(apiKey ? { apiKeyEnc: encryptCredential(apiKey) } : {}),
    },
  });
  await audit({ orgId: user.orgId, userId: user.id, action: "GPS_CONFIG_UPSERT", entity: "FuelGpsConfig", entityId: user.orgId, meta: { enabled, groups: trackedGroups } });
  revalidatePath("/fuelos/settings");
  revalidatePath("/fuelos/dispatch/map");
  revalidatePath("/fuelos/gps");
  return { ok: true };
}

// ทดสอบเชื่อมต่อ → คืนชื่อบัญชี + โควต้า (ไม่คืน key)
export async function testGpsConnection() {
  const user = await requireAdmin();
  const creds = await getOrgXsenseCreds(user.orgId);
  if (!creds) return { ok: false as const, error: "ยังไม่ได้บันทึก api-id / api-key" };

  const s = await getXsenseStatus(creds);
  if (!s.ok) {
    await prisma.fuelGpsConfig.update({ where: { orgId: user.orgId }, data: { lastTestAt: new Date(), lastError: s.error ?? "ทดสอบไม่สำเร็จ" } }).catch(() => {});
    revalidatePath("/fuelos/settings");
    return { ok: false as const, error: s.error ?? "ทดสอบไม่สำเร็จ" };
  }
  await prisma.fuelGpsConfig.update({
    where: { orgId: user.orgId },
    data: {
      accountName: s.accountName ?? null,
      quotaTotal: s.quotaTotal ?? null,
      quotaUsed: s.quotaUsed ?? null,
      quotaUnlimited: s.quotaUnlimited ?? false,
      lastTestAt: new Date(),
      lastError: null,
    },
  });
  await audit({ orgId: user.orgId, userId: user.id, action: "GPS_TEST", entity: "FuelGpsConfig", entityId: user.orgId, meta: { ok: true, accountName: s.accountName } });
  revalidatePath("/fuelos/settings");
  return { ok: true as const, accountName: s.accountName ?? null, quotaTotal: s.quotaTotal ?? null, quotaUsed: s.quotaUsed ?? null, quotaUnlimited: s.quotaUnlimited ?? false };
}
