"use server";

// "เซฟเล่ม" mutations for /ledger/ledger-book (LEDGER_ANALYTICS_V1).
//
// Security bar (mirrors reconcile/_actions.ts):
//   • requireSession + module entitlement for non-admins
//   • company belongs to the caller's org (no cross-org write)
//   • org+company scoped on EVERY row read/write (one org = many legal entities)
// Books are SHARED per company → save = any ledger user; rename/delete = the
// creator OR an admin-tier (so nobody wipes a colleague's book). Delete is audited.

import { requireSession } from "@/lib/auth/session";
import { isAdminTier } from "@/lib/auth/role-guards";
import { userHasModuleAccess } from "@/lib/auth/module-access";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit/log";
import { ledgerAnalyticsV1 } from "@/lib/ledger/flags";
import { listCompanies } from "@/lib/ledger/queries";
import { normalizeBookConfig, type SavedBookConfig } from "@/lib/ledger/saved-books";

export type SavedBookResult = { ok: true } | { ok: false; error: string };

type Gate =
  | { error: string }
  | { session: Awaited<ReturnType<typeof requireSession>>; orgId: string };

async function gate(companyId: string): Promise<Gate> {
  if (!ledgerAnalyticsV1()) return { error: "ฟีเจอร์นี้ยังไม่เปิดใช้" };
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    session = await requireSession();
  } catch {
    return { error: "unauthorized" };
  }
  if (!isAdminTier(session.user.role)) {
    const has = await userHasModuleAccess(session.user, "ledger");
    if (!has) return { error: "ไม่มีสิทธิ์ใช้งานโมดูลนี้" };
  }
  if (!companyId) return { error: "ไม่ได้ระบุบริษัท" };
  const orgId = session.user.org_id;
  const companies = await listCompanies(orgId);
  if (!companies.some((c) => c.id === companyId)) return { error: "ไม่พบบริษัท" };
  return { session, orgId };
}

export async function createSavedBook(input: {
  companyId: string;
  name: string;
  config: SavedBookConfig;
}): Promise<SavedBookResult> {
  const g = await gate(input.companyId);
  if ("error" in g) return { ok: false, error: g.error };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "กรุณาตั้งชื่อเล่ม" };
  if (name.length > 60) return { ok: false, error: "ชื่อเล่มยาวเกินไป (สูงสุด 60 ตัว)" };

  // JSON.parse(stringify(...)) → a plain serializable object (strips undefined,
  // satisfies Prisma's Json input without a fragile cast).
  const config = JSON.parse(JSON.stringify(normalizeBookConfig(input.config)));
  await prisma.ledgerSavedBook.create({
    data: {
      orgId: g.orgId,
      companyId: input.companyId,
      name,
      config,
      createdBy: g.session.user.id,
    },
  });
  revalidatePath("/ledger/ledger-book");
  return { ok: true };
}

export async function renameSavedBook(input: {
  companyId: string;
  id: string;
  name: string;
}): Promise<SavedBookResult> {
  const g = await gate(input.companyId);
  if ("error" in g) return { ok: false, error: g.error };
  const name = input.name.trim();
  if (!name) return { ok: false, error: "กรุณาตั้งชื่อเล่ม" };
  if (name.length > 60) return { ok: false, error: "ชื่อเล่มยาวเกินไป (สูงสุด 60 ตัว)" };

  const book = await prisma.ledgerSavedBook.findFirst({
    where: { id: input.id, orgId: g.orgId, companyId: input.companyId },
    select: { createdBy: true },
  });
  if (!book) return { ok: false, error: "ไม่พบเล่ม" };
  if (book.createdBy !== g.session.user.id && !isAdminTier(g.session.user.role)) {
    return { ok: false, error: "แก้ชื่อได้เฉพาะผู้สร้างหรือแอดมิน" };
  }
  await prisma.ledgerSavedBook.update({ where: { id: input.id }, data: { name } });
  revalidatePath("/ledger/ledger-book");
  return { ok: true };
}

export async function deleteSavedBook(input: {
  companyId: string;
  id: string;
}): Promise<SavedBookResult> {
  const g = await gate(input.companyId);
  if ("error" in g) return { ok: false, error: g.error };

  const book = await prisma.ledgerSavedBook.findFirst({
    where: { id: input.id, orgId: g.orgId, companyId: input.companyId },
    select: { createdBy: true, name: true },
  });
  if (!book) return { ok: false, error: "ไม่พบเล่ม" };
  if (book.createdBy !== g.session.user.id && !isAdminTier(g.session.user.role)) {
    return { ok: false, error: "ลบได้เฉพาะผู้สร้างหรือแอดมิน" };
  }
  await prisma.ledgerSavedBook.delete({ where: { id: input.id } });
  await audit({
    orgId: g.orgId,
    userId: g.session.user.id,
    action: "LEDGER_SAVED_BOOK_DELETED",
    resourceType: "ledger_saved_book",
    resourceId: input.id,
    diff: { old: { name: book.name } },
  });
  revalidatePath("/ledger/ledger-book");
  return { ok: true };
}
