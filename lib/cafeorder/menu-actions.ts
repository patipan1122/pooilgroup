"use server";

// CafeOrder · menu WRITES (create/update/toggle categories + items + variants).
//   ทุก action: requireSession + canCafeManage (ไม่ผ่าน = throw) · scope orgId เสมอ ·
//   revalidate หน้าจัดการเมนู. Result: {ok:true,...} | {ok:false,error}.
//   ไม่มีเรื่องเงินลูกค้าในไฟล์นี้ (ราคาเมนู = master data · ตัวเลขบิลจริงคิดที่ server ตอนสั่ง).

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/session";
import { canCafeManage } from "@/lib/cafeorder/role-guard";
import { CafeBrand, CafeItemKind, CafeTemp, CafeSize } from "@/lib/generated/prisma/enums";

const MENU_PATH = "/cafeorder/office/menu";

type Result<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

async function requireManager(): Promise<{ orgId: string; userId: string }> {
  const session = await requireSession();
  if (!canCafeManage(session.user.role)) throw new Error("ไม่มีสิทธิ์จัดการเมนู");
  return { orgId: session.user.org_id, userId: session.user.id };
}

function errCode(e: unknown): string | undefined {
  return typeof e === "object" && e !== null ? (e as { code?: string }).code : undefined;
}

export async function createCategory(input: { brand: CafeBrand; name: string }): Promise<Result> {
  try {
    const { orgId } = await requireManager();
    const name = input.name.trim();
    if (!name) return { ok: false, error: "กรุณาใส่ชื่อหมวด" };
    const max = await prisma.cafeCategory.aggregate({
      where: { orgId, brand: input.brand },
      _max: { sortOrder: true },
    });
    await prisma.cafeCategory.create({
      data: { orgId, brand: input.brand, name, sortOrder: (max._max.sortOrder ?? 0) + 1 },
    });
    revalidatePath(MENU_PATH);
    return { ok: true };
  } catch (e) {
    if (errCode(e) === "P2002") return { ok: false, error: "มีหมวดชื่อนี้แล้ว" };
    return { ok: false, error: e instanceof Error ? e.message : "สร้างหมวดไม่สำเร็จ" };
  }
}

export type CreateItemInput = {
  brand: CafeBrand;
  categoryId: string;
  name: string;
  description?: string;
  kind: CafeItemKind;
  imageKey?: string | null;
  /** ราคาต่ออุณหภูมิ+ขนาด — อย่างน้อย 1 variant */
  variants: { temp: CafeTemp | null; size: CafeSize; priceCents: number }[];
};

export async function createItem(input: CreateItemInput): Promise<Result<{ id: string }>> {
  try {
    const { orgId } = await requireManager();
    const name = input.name.trim();
    if (!name) return { ok: false, error: "กรุณาใส่ชื่อเมนู" };
    if (!input.variants.length) return { ok: false, error: "ต้องมีราคาอย่างน้อย 1 รูปแบบ" };
    // ยืนยันหมวดเป็นของ org นี้ (กันยิงข้าม org)
    const cat = await prisma.cafeCategory.findFirst({ where: { id: input.categoryId, orgId } });
    if (!cat) return { ok: false, error: "ไม่พบหมวดนี้" };

    const item = await prisma.cafeMenuItem.create({
      data: {
        orgId,
        brand: input.brand,
        categoryId: input.categoryId,
        name,
        description: input.description?.trim() || null,
        kind: input.kind,
        imageKey: input.imageKey ?? null,
        variants: {
          create: input.variants.map((v) => ({
            temp: v.temp,
            size: v.size,
            priceCents: Math.max(0, Math.round(v.priceCents)),
          })),
        },
      },
    });
    revalidatePath(MENU_PATH);
    return { ok: true, data: { id: item.id } };
  } catch (e) {
    if (errCode(e) === "P2002") return { ok: false, error: "มีเมนูชื่อนี้ในแบรนด์นี้แล้ว" };
    return { ok: false, error: e instanceof Error ? e.message : "สร้างเมนูไม่สำเร็จ" };
  }
}

export async function updateItem(input: {
  id: string;
  name?: string;
  description?: string | null;
  categoryId?: string;
  imageKey?: string | null;
}): Promise<Result> {
  try {
    const { orgId } = await requireManager();
    const existing = await prisma.cafeMenuItem.findFirst({ where: { id: input.id, orgId } });
    if (!existing) return { ok: false, error: "ไม่พบเมนูนี้" };
    await prisma.cafeMenuItem.update({
      where: { id: input.id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.imageKey !== undefined ? { imageKey: input.imageKey } : {}),
      },
    });
    revalidatePath(MENU_PATH);
    return { ok: true };
  } catch (e) {
    if (errCode(e) === "P2002") return { ok: false, error: "มีเมนูชื่อนี้แล้ว" };
    return { ok: false, error: e instanceof Error ? e.message : "แก้ไขไม่สำเร็จ" };
  }
}

export async function toggleItemActive(input: { id: string; isActive: boolean }): Promise<Result> {
  try {
    const { orgId } = await requireManager();
    const existing = await prisma.cafeMenuItem.findFirst({ where: { id: input.id, orgId } });
    if (!existing) return { ok: false, error: "ไม่พบเมนูนี้" };
    await prisma.cafeMenuItem.update({ where: { id: input.id }, data: { isActive: input.isActive } });
    revalidatePath(MENU_PATH);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "อัปเดตไม่สำเร็จ" };
  }
}
