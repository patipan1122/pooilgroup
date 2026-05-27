"use server";

// BankAccount CRUD — OFFICE+ · all audit logged
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
  bankName: z.string().trim().min(1, "ต้องระบุชื่อธนาคาร").max(100),
  accountNo: z.string().trim().min(1, "ต้องระบุเลขบัญชี").max(50),
  accountName: z.string().trim().min(1, "ต้องระบุชื่อบัญชี").max(200),
  branchId: z.string().optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function createAccount(formData: FormData): Promise<ActionResult<{ id: string }>> {
  const session = await requireRole("OFFICE");

  const parsed = createSchema.safeParse({
    bankName: formData.get("bankName"),
    accountNo: formData.get("accountNo"),
    accountName: formData.get("accountName"),
    branchId: formData.get("branchId") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const account = await prisma.chairopsBankAccount.create({
    data: {
      orgId: session.user.orgId,
      bankName: parsed.data.bankName,
      accountNo: parsed.data.accountNo,
      accountName: parsed.data.accountName,
      branchId: parsed.data.branchId || null,
      notes: parsed.data.notes || null,
      isActive: true,
    },
  });

  await writeAudit({
    userId: session.user.id,
    action: "bank_account.create",
    entity: "BankAccount",
    entityId: account.id,
    oldValue: null,
    newValue: account,
  });

  revalidatePath("/chairops/accounts");
  return { ok: true, data: { id: account.id } };
}

const updateSchema = z.object({
  id: zUUID(),
  bankName: z.string().trim().min(1).max(100),
  accountNo: z.string().trim().min(1).max(50),
  accountName: z.string().trim().min(1).max(200),
  branchId: z.string().optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function updateAccount(formData: FormData): Promise<ActionResult> {
  const session = await requireRole("OFFICE");

  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    bankName: formData.get("bankName"),
    accountNo: formData.get("accountNo"),
    accountName: formData.get("accountName"),
    branchId: formData.get("branchId") || undefined,
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const old = await prisma.chairopsBankAccount.findFirst({
    where: { id: parsed.data.id, orgId: session.user.orgId },
  });
  if (!old) return { ok: false, error: "ไม่พบบัญชี" };

  const updated = await prisma.chairopsBankAccount.update({
    where: { id: parsed.data.id },
    data: {
      bankName: parsed.data.bankName,
      accountNo: parsed.data.accountNo,
      accountName: parsed.data.accountName,
      branchId: parsed.data.branchId || null,
      notes: parsed.data.notes || null,
    },
  });

  await writeAudit({
    userId: session.user.id,
    action: "bank_account.update",
    entity: "BankAccount",
    entityId: updated.id,
    oldValue: old,
    newValue: updated,
  });

  revalidatePath("/chairops/accounts");
  return { ok: true };
}

export async function deactivateAccount(id: string): Promise<ActionResult> {
  const session = await requireRole("OFFICE");

  const parsed = zUUID().safeParse(id);
  if (!parsed.success) return { ok: false, error: "ID ไม่ถูกต้อง" };

  const old = await prisma.chairopsBankAccount.findFirst({
    where: { id: parsed.data, orgId: session.user.orgId },
  });
  if (!old) return { ok: false, error: "ไม่พบบัญชี" };

  const updated = await prisma.chairopsBankAccount.update({
    where: { id: parsed.data },
    data: { isActive: !old.isActive },
  });

  await writeAudit({
    userId: session.user.id,
    action: old.isActive ? "bank_account.deactivate" : "bank_account.reactivate",
    entity: "BankAccount",
    entityId: updated.id,
    oldValue: { isActive: old.isActive },
    newValue: { isActive: updated.isActive },
  });

  revalidatePath("/chairops/accounts");
  return { ok: true };
}
