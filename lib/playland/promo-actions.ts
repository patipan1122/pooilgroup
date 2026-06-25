"use server";

// Playland · จัดการโปรโมชั่น (ส่วนกลาง) — CRUD เท่านั้น
// CEO policy: ส่วนลดทั้งหมดมาจากที่นี่ · แคชเชียร์ลดเองไม่ได้
// NOTE: enforcement engine (ใช้โปรที่ POS · validate maxUses · เพิ่ม usesCount) = Wave 3 · ไม่ทำตอนนี้
// ทุก action: requireSession + requirePlaylandManager + verifyBranchOrg (ถ้ามี branchId) · scope ด้วย orgId

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { requirePlaylandManager } from "./role-guard";
import { getPlaylandRole } from "./position-resolve";
import { verifyBranchOrg } from "./guards";
import type { PlaylandPromoType } from "@/lib/generated/prisma/enums";

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };
const err = (msg: string): { ok: false; error: string } => ({ ok: false, error: msg });

const PROMO_TYPES: PlaylandPromoType[] = ["COUPON", "LOYALTY_POINTS", "BIRTHDAY", "WEEKDAY", "HAPPY_HOUR", "PACKAGE_DISCOUNT"];

export interface UpsertPromoInput {
  id?: string;
  code?: string;
  name: string;
  type: PlaylandPromoType;
  discountPercent?: number;
  discountCents?: number;
  maxUses?: number;
  startsAt?: string;
  endsAt?: string;
  branchId?: string; // null/undefined = ทุกสาขา
  active: boolean;
}

export async function upsertPromo(input: UpsertPromoInput): Promise<ActionResult<{ promoId: string }>> {
  const session = await requireSession();
  requirePlaylandManager(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role));
  const orgId = session.user.org_id;

  if (!input.name.trim()) return err("กรุณาใส่ชื่อโปรโมชั่น");
  if (!PROMO_TYPES.includes(input.type)) return err("ประเภทโปรไม่ถูกต้อง");
  // ส่วนลดต้องเลือกอย่างใดอย่างหนึ่ง (% หรือ บาท) ไม่ใช่ทั้งคู่
  if (input.discountPercent != null && input.discountCents != null) return err("เลือกส่วนลดได้แค่ % หรือ บาท อย่างใดอย่างหนึ่ง");
  if (input.discountPercent != null && (input.discountPercent < 0 || input.discountPercent > 100)) return err("ส่วนลด % ต้องอยู่ระหว่าง 0–100");
  if (input.discountCents != null && input.discountCents < 0) return err("ส่วนลด (บาท) ต้องไม่ติดลบ");

  // ถ้าผูกสาขา → สาขานั้นต้องอยู่ใน org เดียวกัน (null = ทุกสาขา ผ่านได้)
  if (input.branchId && !(await verifyBranchOrg(input.branchId, orgId))) return err("สาขาไม่อยู่ใน org");

  const data = {
    type: input.type,
    code: input.code?.trim() || null,
    name: input.name.trim(),
    discountPercent: input.discountPercent ?? null,
    discountCents: input.discountCents ?? null,
    maxUses: input.maxUses ?? null,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    branchId: input.branchId || null,
    active: input.active,
  };

  try {
    if (input.id) {
      const u = await prisma.playlandPromo.update({ where: { id: input.id, orgId }, data });
      revalidatePath("/playland/settings/promos");
      return { ok: true, data: { promoId: u.id } };
    }
    const c = await prisma.playlandPromo.create({ data: { orgId, ...data } });
    revalidatePath("/playland/settings/promos");
    return { ok: true, data: { promoId: c.id } };
  } catch (e) {
    // @@unique([code, orgId]) → code ซ้ำใน org
    if (e instanceof Error && e.message.includes("Unique constraint")) return err("รหัสคูปอง (code) นี้ถูกใช้แล้ว");
    return err("บันทึกไม่สำเร็จ");
  }
}

export async function togglePromo(input: { id: string; active: boolean }): Promise<ActionResult> {
  const session = await requireSession();
  requirePlaylandManager(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role));
  await prisma.playlandPromo.updateMany({ where: { id: input.id, orgId: session.user.org_id }, data: { active: input.active } });
  revalidatePath("/playland/settings/promos");
  return { ok: true, data: undefined };
}

export async function deletePromo(input: { id: string }): Promise<ActionResult> {
  const session = await requireSession();
  requirePlaylandManager(await getPlaylandRole(session.user.id, session.user.org_id, session.user.role));
  await prisma.playlandPromo.deleteMany({ where: { id: input.id, orgId: session.user.org_id } });
  revalidatePath("/playland/settings/promos");
  return { ok: true, data: undefined };
}
