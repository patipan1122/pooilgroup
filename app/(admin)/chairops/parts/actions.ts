"use server";

// Spare parts CRUD + stock adjust — all mutations audit logged
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { writeAudit } from "@/lib/chairops/audit/log";
import { zUUID } from "@/lib/chairops/schemas/zod-helpers";

export type ActionResult<T = void> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const createSchema = z.object({
  partCode: z.string().trim().min(1, "ต้องระบุรหัสอะไหล่").max(50),
  name: z.string().trim().min(1, "ต้องระบุชื่อ").max(200),
  category: z.string().trim().max(100).optional().or(z.literal("")),
  unit: z.string().trim().min(1).max(20).default("ชิ้น"),
  unitPrice: z.coerce.number().int().nonnegative().optional(),
  stockOnHand: z.coerce.number().int().nonnegative().default(0),
  reorderLevel: z.coerce.number().int().nonnegative().default(0),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function createPart(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const session = await requireRole("OFFICE");

  const parsed = createSchema.safeParse({
    partCode: formData.get("partCode"),
    name: formData.get("name"),
    category: formData.get("category") || undefined,
    unit: formData.get("unit") || "ชิ้น",
    unitPrice: formData.get("unitPrice") || undefined,
    stockOnHand: formData.get("stockOnHand") || 0,
    reorderLevel: formData.get("reorderLevel") || 0,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  // Unique check
  const dup = await prisma.chairopsSparePart.findUnique({ where: { partCode: parsed.data.partCode } });
  if (dup) return { ok: false, error: `รหัสอะไหล่ ${parsed.data.partCode} มีอยู่แล้ว` };

  // Wave-0 fix: create part + seed movement + audit atomic
  const part = await prisma.$transaction(async (tx) => {
    const row = await tx.chairopsSparePart.create({
      data: {
        partCode: parsed.data.partCode,
        name: parsed.data.name,
        category: parsed.data.category || null,
        unit: parsed.data.unit,
        unitPrice: parsed.data.unitPrice ?? null,
        stockOnHand: parsed.data.stockOnHand,
        reorderLevel: parsed.data.reorderLevel,
        notes: parsed.data.notes || null,
      },
    });

    if (row.stockOnHand > 0) {
      await tx.chairopsSparePartMovement.create({
        data: {
          partId: row.id,
          delta: row.stockOnHand,
          reason: "initial-stock",
          byUserId: session.user.id,
        },
      });
    }

    await writeAudit(
      {
        userId: session.user.id,
        action: "spare_part.create",
        entity: "SparePart",
        entityId: row.id,
        oldValue: null,
        newValue: row,
      },
      tx,
    );

    return row;
  });

  revalidatePath("/chairops/parts");
  return { ok: true, data: { id: part.id } };
}

const updateSchema = z.object({
  id: zUUID(),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().max(100).optional().or(z.literal("")),
  unit: z.string().trim().min(1).max(20),
  unitPrice: z.coerce.number().int().nonnegative().optional(),
  reorderLevel: z.coerce.number().int().nonnegative(),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function updatePart(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("OFFICE");

  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    category: formData.get("category") || undefined,
    unit: formData.get("unit"),
    unitPrice: formData.get("unitPrice") || undefined,
    reorderLevel: formData.get("reorderLevel") || 0,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const old = await prisma.chairopsSparePart.findUnique({ where: { id: parsed.data.id } });
  if (!old) return { ok: false, error: "ไม่พบอะไหล่" };

  // Wave-0 fix: update + audit atomic
  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.chairopsSparePart.update({
      where: { id: parsed.data.id },
      data: {
        name: parsed.data.name,
        category: parsed.data.category || null,
        unit: parsed.data.unit,
        unitPrice: parsed.data.unitPrice ?? null,
        reorderLevel: parsed.data.reorderLevel,
        notes: parsed.data.notes || null,
      },
    });

    await writeAudit(
      {
        userId: session.user.id,
        action: "spare_part.update",
        entity: "SparePart",
        entityId: row.id,
        oldValue: old,
        newValue: row,
      },
      tx,
    );

    return row;
  });

  revalidatePath("/chairops/parts");
  revalidatePath(`/chairops/parts/${updated.id}`);
  return { ok: true };
}

const adjustSchema = z.object({
  partId: zUUID(),
  delta: z.coerce.number().int().refine((n) => n !== 0, "ต้องระบุจำนวนที่ไม่เป็นศูนย์"),
  reason: z.string().trim().min(1, "ต้องระบุเหตุผล").max(200),
});

export async function adjustStock(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("OFFICE");

  const parsed = adjustSchema.safeParse({
    partId: formData.get("partId"),
    delta: formData.get("delta"),
    reason: formData.get("reason"),
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const part = await prisma.chairopsSparePart.findUnique({ where: { id: parsed.data.partId } });
  if (!part) return { ok: false, error: "ไม่พบอะไหล่" };

  const newStock = part.stockOnHand + parsed.data.delta;
  if (newStock < 0)
    return { ok: false, error: `จะติดลบ (เหลือ ${part.stockOnHand}, จะลด ${Math.abs(parsed.data.delta)})` };

  // Wave-0 fix: stock update + movement + audit atomic (moved from sequential
  // tx-array into async tx so audit can use the same tx client)
  await prisma.$transaction(async (tx) => {
    await tx.chairopsSparePart.update({
      where: { id: part.id },
      data: { stockOnHand: newStock },
    });
    await tx.chairopsSparePartMovement.create({
      data: {
        partId: part.id,
        delta: parsed.data.delta,
        reason: parsed.data.reason,
        byUserId: session.user.id,
      },
    });

    await writeAudit(
      {
        userId: session.user.id,
        action: "spare_part.adjust_stock",
        entity: "SparePart",
        entityId: part.id,
        oldValue: { stockOnHand: part.stockOnHand },
        newValue: { stockOnHand: newStock, delta: parsed.data.delta, reason: parsed.data.reason },
      },
      tx,
    );
  });

  revalidatePath("/chairops/parts");
  revalidatePath(`/chairops/parts/${part.id}`);
  return { ok: true };
}

