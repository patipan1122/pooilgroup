"use server";

// DC คลังกลาง · งานหลังบ้าน — สร้าง/แก้/ตั้งค่าเริ่มต้น/เปิด-ปิด คลัง + ผูกสิทธิ์พนักงานต่อคลัง
//
// การ์ดสิทธิ์:
//   • createWarehouse / rename / setDefault / toggleActive → ผู้จัดการขึ้นไป (canDcManage)
//   • assign / remove / setRole (ผูกพนักงานเข้าคลัง) → แอดมินเท่านั้น (canDcAdmin)
// ทุก action scope ด้วย orgId ของ session เสมอ (กันข้ามองค์กร)

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canDcManage, canDcAdmin } from "@/lib/dc/role-guard";
import { warehouseCode } from "@/lib/dc/codes";
import { DcWarehouseRole } from "@/lib/generated/prisma/enums";

export type ActionResult = { ok: true } | { ok: false; error: string };

const WAREHOUSES_PATH = "/dc/office/warehouses";
const PERMISSIONS_PATH = "/dc/office/permissions";

function revalidateDc() {
  revalidatePath(WAREHOUSES_PATH);
  revalidatePath(PERMISSIONS_PATH);
  // คลัง active อ่านจาก cookie ใน layout → เผื่อรายชื่อคลังเปลี่ยน
  revalidatePath("/dc", "layout");
}

// ── คลัง (master) ─────────────────────────────────────────────

export async function createWarehouse(input: {
  name: string;
  location?: string;
}): Promise<ActionResult> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) {
    return { ok: false, error: "ไม่มีสิทธิ์สร้างคลัง" };
  }
  const orgId = session.user.org_id;
  const name = input.name.trim();
  if (!name) return { ok: false, error: "กรุณากรอกชื่อคลัง" };

  try {
    // คลังแรกขององค์กร → ตั้งเป็นค่าเริ่มต้นให้อัตโนมัติ
    const existing = await prisma.dcWarehouse.count({ where: { orgId } });
    await prisma.dcWarehouse.create({
      data: {
        orgId,
        code: warehouseCode(),
        name,
        location: input.location?.trim() || null,
        isDefault: existing === 0,
      },
    });
    revalidateDc();
    return { ok: true };
  } catch {
    return { ok: false, error: "สร้างคลังไม่สำเร็จ" };
  }
}

export async function renameWarehouse(
  id: string,
  input: { name: string; location?: string },
): Promise<ActionResult> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) {
    return { ok: false, error: "ไม่มีสิทธิ์แก้ไขคลัง" };
  }
  const orgId = session.user.org_id;
  const name = input.name.trim();
  if (!name) return { ok: false, error: "กรุณากรอกชื่อคลัง" };

  try {
    const res = await prisma.dcWarehouse.updateMany({
      where: { id, orgId },
      data: { name, location: input.location?.trim() || null },
    });
    if (res.count === 0) return { ok: false, error: "ไม่พบคลังนี้" };
    revalidateDc();
    return { ok: true };
  } catch {
    return { ok: false, error: "แก้ไขคลังไม่สำเร็จ" };
  }
}

export async function setDefaultWarehouse(id: string): Promise<ActionResult> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) {
    return { ok: false, error: "ไม่มีสิทธิ์ตั้งคลังเริ่มต้น" };
  }
  const orgId = session.user.org_id;

  try {
    // ยืนยันว่าคลังเป็นขององค์กรนี้ ก่อนสลับธง
    const target = await prisma.dcWarehouse.findFirst({
      where: { id, orgId },
      select: { id: true },
    });
    if (!target) return { ok: false, error: "ไม่พบคลังนี้" };

    // ตั้งคลังนี้เป็น default + ปลดคลังอื่นในองค์กรเดียวกัน (atomic)
    await prisma.$transaction([
      prisma.dcWarehouse.updateMany({
        where: { orgId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      }),
      prisma.dcWarehouse.update({
        where: { id },
        data: { isDefault: true },
      }),
    ]);
    revalidateDc();
    return { ok: true };
  } catch {
    return { ok: false, error: "ตั้งคลังเริ่มต้นไม่สำเร็จ" };
  }
}

export async function toggleWarehouseActive(
  id: string,
  isActive: boolean,
): Promise<ActionResult> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) {
    return { ok: false, error: "ไม่มีสิทธิ์เปิด/ปิดคลัง" };
  }
  const orgId = session.user.org_id;

  try {
    const res = await prisma.dcWarehouse.updateMany({
      where: { id, orgId },
      data: { isActive },
    });
    if (res.count === 0) return { ok: false, error: "ไม่พบคลังนี้" };
    revalidateDc();
    return { ok: true };
  } catch {
    return { ok: false, error: "อัปเดตสถานะคลังไม่สำเร็จ" };
  }
}

// ── สิทธิ์พนักงานต่อคลัง (binding) ─────────────────────────────

/** ยืนยันว่าคลังเป็นขององค์กรนี้ก่อนผูกพนักงาน (กันผูกข้ามองค์กร). */
async function assertWarehouseInOrg(
  warehouseId: string,
  orgId: string,
): Promise<boolean> {
  const wh = await prisma.dcWarehouse.findFirst({
    where: { id: warehouseId, orgId },
    select: { id: true },
  });
  return !!wh;
}

export async function assignWarehouseUser(input: {
  warehouseId: string;
  userId: string;
  role: DcWarehouseRole;
}): Promise<ActionResult> {
  const session = await requireSession();
  if (!canDcAdmin(session.user.role)) {
    return { ok: false, error: "ไม่มีสิทธิ์จัดการสิทธิ์พนักงาน" };
  }
  const orgId = session.user.org_id;

  try {
    if (!(await assertWarehouseInOrg(input.warehouseId, orgId))) {
      return { ok: false, error: "ไม่พบคลังนี้" };
    }
    // @@unique([userId, warehouseId]) → upsert เป็น idempotent: ผูกซ้ำ = อัปเดต role + เปิดใช้
    await prisma.dcWarehouseUser.upsert({
      where: {
        userId_warehouseId: {
          userId: input.userId,
          warehouseId: input.warehouseId,
        },
      },
      create: {
        orgId,
        warehouseId: input.warehouseId,
        userId: input.userId,
        role: input.role,
        isActive: true,
      },
      update: {
        role: input.role,
        isActive: true,
      },
    });
    revalidatePath(PERMISSIONS_PATH);
    revalidatePath("/dc", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "ผูกสิทธิ์ไม่สำเร็จ" };
  }
}

export async function removeWarehouseUser(input: {
  warehouseId: string;
  userId: string;
}): Promise<ActionResult> {
  const session = await requireSession();
  if (!canDcAdmin(session.user.role)) {
    return { ok: false, error: "ไม่มีสิทธิ์จัดการสิทธิ์พนักงาน" };
  }
  const orgId = session.user.org_id;

  try {
    // soft-remove: ปิด isActive (เก็บประวัติการผูกไว้)
    const res = await prisma.dcWarehouseUser.updateMany({
      where: { orgId, warehouseId: input.warehouseId, userId: input.userId },
      data: { isActive: false },
    });
    if (res.count === 0) return { ok: false, error: "ไม่พบการผูกสิทธิ์นี้" };
    revalidatePath(PERMISSIONS_PATH);
    revalidatePath("/dc", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "ยกเลิกสิทธิ์ไม่สำเร็จ" };
  }
}

export async function setWarehouseUserRole(input: {
  warehouseId: string;
  userId: string;
  role: DcWarehouseRole;
}): Promise<ActionResult> {
  const session = await requireSession();
  if (!canDcAdmin(session.user.role)) {
    return { ok: false, error: "ไม่มีสิทธิ์จัดการสิทธิ์พนักงาน" };
  }
  const orgId = session.user.org_id;

  try {
    const res = await prisma.dcWarehouseUser.updateMany({
      where: {
        orgId,
        warehouseId: input.warehouseId,
        userId: input.userId,
        isActive: true,
      },
      data: { role: input.role },
    });
    if (res.count === 0) return { ok: false, error: "ไม่พบการผูกสิทธิ์นี้" };
    revalidatePath(PERMISSIONS_PATH);
    revalidatePath("/dc", "layout");
    return { ok: true };
  } catch {
    return { ok: false, error: "เปลี่ยนตำแหน่งไม่สำเร็จ" };
  }
}
