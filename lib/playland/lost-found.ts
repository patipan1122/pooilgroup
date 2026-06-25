"use server";

// Playland · ของหาย-ของเก็บได้ (Lost & Found) — บันทึกของที่เด็ก/ลูกค้าลืม · ตามเจ้าของ · ทิ้ง/บริจาค
// ทุก action: requireSession + requirePlaylandCashier (staff ทำได้) + verify item/branch อยู่ใน org ก่อนเขียน

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canPlaylandCashier, canPlaylandManage } from "./role-guard";
import { verifyBranchOrg } from "./guards";
import { newLostFoundCode } from "./codes";

type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: string };
const err = (m: string) => ({ ok: false as const, error: m });

// ── บันทึกของที่เก็บได้ใหม่ → status "stored" ──
export async function recordLostItem(input: {
  branchId: string;
  itemName: string;
  foundLocation?: string;
  foundAt: string | Date;
  description?: string;
  contactPhone?: string;
}): Promise<ActionResult<{ id: string; itemCode: string }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์บันทึกของเก็บได้");
  if (!(await verifyBranchOrg(input.branchId, session.user.org_id))) return err("สาขาไม่อยู่ใน org");
  if (!input.itemName.trim()) return err("ใส่ชื่อของที่เก็บได้");
  const foundAt = new Date(input.foundAt);
  if (isNaN(foundAt.getTime())) return err("วันเวลาที่เก็บได้ไม่ถูกต้อง");

  try {
    const row = await prisma.playlandLostFound.create({
      data: {
        orgId: session.user.org_id,
        branchId: input.branchId,
        itemCode: newLostFoundCode(),
        status: "stored",
        itemName: input.itemName.trim(),
        description: input.description?.trim() || null,
        foundLocation: input.foundLocation?.trim() || null,
        foundAt,
        contactPhone: input.contactPhone?.trim() || null,
        recordedByUserId: session.user.id,
      },
      select: { id: true, itemCode: true },
    });
    revalidatePath("/playland/lost-found");
    return { ok: true, data: row };
  } catch (e) {
    return err(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
  }
}

// ── คืนของให้เจ้าของ → status "claimed" + เวลา + ชื่อผู้รับ ──
export async function claimLostItem(input: {
  itemId: string;
  claimedByName: string;
}): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์คืนของ");
  if (!input.claimedByName.trim()) return err("ใส่ชื่อผู้มารับของ");
  // verify ของชิ้นนี้อยู่ใน org เดียวกัน + ยังเก็บอยู่
  const item = await prisma.playlandLostFound.findFirst({
    where: { id: input.itemId, orgId: session.user.org_id },
    select: { id: true, status: true },
  });
  if (!item) return err("ไม่พบรายการ หรือไม่อยู่ใน org");
  if (item.status !== "stored") return err("รายการนี้คืน/ทิ้งไปแล้ว");

  try {
    await prisma.playlandLostFound.update({
      where: { id: input.itemId },
      data: { status: "claimed", claimedAt: new Date(), claimedByName: input.claimedByName.trim() },
    });
    revalidatePath("/playland/lost-found");
    return { ok: true, data: { id: input.itemId } };
  } catch (e) {
    return err(e instanceof Error ? e.message : "คืนของไม่สำเร็จ");
  }
}

// ── ทิ้ง/บริจาคของที่ไม่มีคนมารับ → status "disposed" ──
export async function disposeLostItem(input: {
  itemId: string;
}): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  if (!canPlaylandCashier(session.user.role)) return err("ไม่มีสิทธิ์ทิ้ง/บริจาค");
  const item = await prisma.playlandLostFound.findFirst({
    where: { id: input.itemId, orgId: session.user.org_id },
    select: { id: true, status: true },
  });
  if (!item) return err("ไม่พบรายการ หรือไม่อยู่ใน org");
  if (item.status !== "stored") return err("รายการนี้คืน/ทิ้งไปแล้ว");

  try {
    await prisma.playlandLostFound.update({
      where: { id: input.itemId },
      data: { status: "disposed" },
    });
    revalidatePath("/playland/lost-found");
    return { ok: true, data: { id: input.itemId } };
  } catch (e) {
    return err(e instanceof Error ? e.message : "ทิ้ง/บริจาคไม่สำเร็จ");
  }
}

// ── ลบรายการของหาย (ผู้จัดการขึ้นไป · เก็บ snapshot ลง audit ก่อนลบ) ──
export async function deleteLostFound(id: string): Promise<ActionResult<{ id: string }>> {
  const session = await requireSession();
  if (!canPlaylandManage(session.user.role)) return err("เฉพาะผู้จัดการขึ้นไปลบได้");
  const rec = await prisma.playlandLostFound.findFirst({ where: { id, orgId: session.user.org_id } });
  if (!rec) return err("ไม่พบรายการ หรือไม่อยู่ใน org");
  try {
    await prisma.$transaction([
      prisma.playlandAuditLog.create({
        data: {
          orgId: session.user.org_id, branchId: rec.branchId, actorUserId: session.user.id, actorRole: session.user.role,
          action: "lostfound.delete", entityType: "PlaylandLostFound", entityId: rec.id,
          before: JSON.parse(JSON.stringify(rec)), category: "general",
        },
      }),
      prisma.playlandLostFound.delete({ where: { id } }),
    ]);
    revalidatePath("/playland/lost-found");
    return { ok: true, data: { id } };
  } catch (e) {
    return err(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
  }
}
