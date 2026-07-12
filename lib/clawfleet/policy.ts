"use server";

// ClawFleet · ตู้คีบ OS — นโยบายระบบ (policy toggles)
// เก็บใน Organization.settings.clawfleetPolicy (JSON · ไม่ต้อง migration).
// safety toggle ทั้งหมด default = ON (เปิดป้องกันไว้ก่อน).
// อ่าน-แก้-เขียน JSON: preserve key อื่นใน settings เสมอ (read-modify-write).

import { revalidatePath } from "next/cache";
import type { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { assertCfAdmin } from "./role-guard";

const SETTINGS_PATH = "/clawfleet/os/settings";
const POLICY_KEY = "clawfleetPolicy";

/** นโยบาย 4 ข้อ (key ตรงกับ toggle ใน settings-client)
 *
 * NOTE (audit 2026-07-01): ตอนนี้มีแค่ `photoRequired` ที่ถูกอ่านไปบังคับใช้จริง
 * (lib/clawfleet/actions.ts — บล็อกปิดรอบถ้าไม่มีรูปเงินสด). อีก 3 ตัว
 * (cashAlert / lockConfig / meterMatch) persist ลง DB ได้ แต่ยัง "ไม่มี reader"
 * ที่เอาไปบังคับใช้ → ใน settings UI จึงถูก disable + ป้าย "เร็วๆนี้" กัน HQ เชื่อผิด.
 * เมื่อเพิ่ม logic บังคับใช้จริงของแต่ละตัวแล้ว ค่อยเปลี่ยน live=true ใน settings-client.
 */
// ⚠️ NOTE (CEO 2026-07-12): photoRequired ใช้เฉพาะ "รอบเก็บปกติ" (actions.ts) เท่านั้น.
//   หน้า "ตั้งค่าครั้งแรก" (baseline-actions.ts) รูปทุกใบ OPTIONAL เสมอ — ไม่บล็อกด้วย policy ตัวนี้.
//   baseline ต้องการ "เลขมิเตอร์ครบ" เป็น anchor แทน (รูปเป็นตัวเสริม, null = incomplete).
//   ห้ามเอา photoRequired ไป gate baseline ในอนาคต (จะทำให้แม่บ้านตั้งตู้ไม่ได้ตอนกล้อง/เน็ตมีปัญหา).
export type ClawfleetPolicy = {
  photoRequired: boolean; // บังคับถ่ายรูปก่อน–หลังเติม (LIVE · actions.ts บังคับใช้ · ไม่ใช้กับ baseline)
  cashAlert: boolean; // เตือนเงินไม่ตรงทันที (ยังไม่มี reader — UI disabled)
  lockConfig: boolean; // ล็อกค่าตู้รออนุมัติ (ยังไม่มี reader — UI disabled)
  meterMatch: boolean; // มิเตอร์เฟือง + ดิจิตอลต้องเท่ากัน (ยังไม่มี reader — UI disabled)
};

/** ดีฟอลต์ — safety ON ทั้งหมด ยกเว้น lockConfig (ตามดีไซน์เดิม off) */
const DEFAULT_POLICY: ClawfleetPolicy = {
  photoRequired: true,
  cashAlert: true,
  lockConfig: false,
  meterMatch: true,
};

/** อ่าน policy block จาก settings JSON อย่างปลอดภัย (type-narrow ทีละ key) */
function parsePolicy(settings: Prisma.JsonValue | null | undefined): ClawfleetPolicy {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return { ...DEFAULT_POLICY };
  const raw = (settings as Record<string, unknown>)[POLICY_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_POLICY };
  const p = raw as Record<string, unknown>;
  return {
    photoRequired: typeof p.photoRequired === "boolean" ? p.photoRequired : DEFAULT_POLICY.photoRequired,
    cashAlert: typeof p.cashAlert === "boolean" ? p.cashAlert : DEFAULT_POLICY.cashAlert,
    lockConfig: typeof p.lockConfig === "boolean" ? p.lockConfig : DEFAULT_POLICY.lockConfig,
    meterMatch: typeof p.meterMatch === "boolean" ? p.meterMatch : DEFAULT_POLICY.meterMatch,
  };
}

/** อ่านนโยบายของ org ปัจจุบัน (merge over defaults) */
export async function getClawfleetPolicy(): Promise<ClawfleetPolicy> {
  const session = await requireSession();
  const org = await prisma.organization.findUnique({
    where: { id: session.user.org_id },
    select: { settings: true },
  });
  return parsePolicy(org?.settings);
}

type Result = { ok: true; data: ClawfleetPolicy } | { ok: false; error: string };

/**
 * บันทึกนโยบาย (partial merge) · admin-tier เท่านั้น.
 * read-modify-write: เก็บ key อื่นใน settings ไว้ครบ · merge เฉพาะ clawfleetPolicy.
 */
export async function saveClawfleetPolicy(partial: Partial<ClawfleetPolicy>): Promise<Result> {
  const session = await assertCfAdmin();
  const orgId = session.user.org_id;

  // sanitize: รับเฉพาะ key ที่รู้จัก + เป็น boolean
  const clean: Partial<ClawfleetPolicy> = {};
  if (typeof partial.photoRequired === "boolean") clean.photoRequired = partial.photoRequired;
  if (typeof partial.cashAlert === "boolean") clean.cashAlert = partial.cashAlert;
  if (typeof partial.lockConfig === "boolean") clean.lockConfig = partial.lockConfig;
  if (typeof partial.meterMatch === "boolean") clean.meterMatch = partial.meterMatch;
  if (Object.keys(clean).length === 0) return { ok: false, error: "ไม่มีนโยบายที่จะบันทึก" };

  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true },
    });
    if (!org) return { ok: false, error: "ไม่พบองค์กร" };

    const current = parsePolicy(org.settings);
    const merged: ClawfleetPolicy = { ...current, ...clean };

    // preserve key อื่นใน settings — spread object เดิมก่อนทับ clawfleetPolicy
    const base =
      org.settings && typeof org.settings === "object" && !Array.isArray(org.settings)
        ? (org.settings as Record<string, unknown>)
        : {};
    const nextSettings = { ...base, [POLICY_KEY]: merged } as Prisma.InputJsonValue;

    await prisma.organization.update({
      where: { id: orgId },
      data: { settings: nextSettings },
    });
    revalidatePath(SETTINGS_PATH);
    return { ok: true, data: merged };
  } catch (e) {
    return { ok: false, error: `บันทึกนโยบายไม่สำเร็จ: ${(e as Error).message}` };
  }
}
