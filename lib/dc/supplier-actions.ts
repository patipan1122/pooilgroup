"use server";

// DC คลังกลาง · ทะเบียนผู้ขาย (Suppliers master, ส่วนใหญ่โรงงานจีน) — server actions.
//
// การ์ดสิทธิ์: ทุก action = requireSession + canDcManage(role) (ไม่ผ่าน = คืน error
//   ไม่ throw — Result pattern เหมือน warehouse-admin-actions) · scope ทุก query
//   ด้วย orgId เสมอ (กันข้ามองค์กร) · revalidate หน้าทะเบียนผู้ขาย.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canDcManage } from "@/lib/dc/role-guard";

const SUPPLIERS_PATH = "/dc/office/suppliers";

export type SupplierActionResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export type CreateSupplierInput = {
  name: string;
  country?: string | null;
  contact?: string | null;
  wechat?: string | null;
  paymentTerms?: string | null;
  note?: string | null;
};

export type UpdateSupplierInput = CreateSupplierInput;

/** Guard: ต้อง login + มีสิทธิ์ manage หลังบ้าน DC. */
async function requireManager(): Promise<
  { ok: true; orgId: string; userId: string } | { ok: false; error: string }
> {
  const session = await requireSession();
  if (!canDcManage(session.user.role)) {
    return { ok: false, error: "ไม่มีสิทธิ์จัดการทะเบียนผู้ขาย" };
  }
  return { ok: true, orgId: session.user.org_id, userId: session.user.id };
}

function cleanStr(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : null;
}

/** สร้างผู้ขายใหม่ (default ประเทศ = จีน CN) */
export async function createSupplier(
  input: CreateSupplierInput,
): Promise<SupplierActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;

  const name = cleanStr(input.name);
  if (!name) return { ok: false, error: "กรุณากรอกชื่อผู้ขาย" };

  try {
    const supplier = await prisma.dcSupplier.create({
      data: {
        orgId: g.orgId,
        name,
        country: cleanStr(input.country) ?? "CN",
        contact: cleanStr(input.contact),
        wechat: cleanStr(input.wechat),
        paymentTerms: cleanStr(input.paymentTerms),
        note: cleanStr(input.note),
        active: true,
      },
      select: { id: true },
    });
    revalidatePath(SUPPLIERS_PATH);
    return { ok: true, id: supplier.id };
  } catch {
    return { ok: false, error: "บันทึกผู้ขายไม่สำเร็จ ลองอีกครั้ง" };
  }
}

/** แก้ไขผู้ขายของ org ตัวเอง (scope ด้วย orgId กัน cross-org) */
export async function updateSupplier(
  id: string,
  input: UpdateSupplierInput,
): Promise<SupplierActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;

  const name = cleanStr(input.name);
  if (!name) return { ok: false, error: "กรุณากรอกชื่อผู้ขาย" };

  // ยืนยันว่าผู้ขายเป็นของ org นี้ก่อน
  const existing = await prisma.dcSupplier.findFirst({
    where: { id, orgId: g.orgId },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "ไม่พบผู้ขายนี้ในองค์กรของคุณ" };

  try {
    await prisma.dcSupplier.update({
      where: { id },
      data: {
        name,
        country: cleanStr(input.country) ?? "CN",
        contact: cleanStr(input.contact),
        wechat: cleanStr(input.wechat),
        paymentTerms: cleanStr(input.paymentTerms),
        note: cleanStr(input.note),
      },
      select: { id: true },
    });
    revalidatePath(SUPPLIERS_PATH);
    return { ok: true, id };
  } catch {
    return { ok: false, error: "แก้ไขผู้ขายไม่สำเร็จ ลองอีกครั้ง" };
  }
}

/** เปิด/ปิดการใช้งานผู้ขาย (soft) ของ org ตัวเอง */
export async function toggleSupplierActive(
  id: string,
  active: boolean,
): Promise<SupplierActionResult> {
  const g = await requireManager();
  if (!g.ok) return g;

  const res = await prisma.dcSupplier.updateMany({
    where: { id, orgId: g.orgId },
    data: { active },
  });
  if (res.count === 0) return { ok: false, error: "ไม่พบผู้ขายนี้ในองค์กรของคุณ" };
  revalidatePath(SUPPLIERS_PATH);
  return { ok: true, id };
}
