"use server";

// Office-side maid employment-contract actions (F4b · CEO 2026-08-02).
//
// The office ORIGINATES the contract: fills the maid's details (name, nickname,
// address, ID card, wage, bank) and saves a DRAFT. The maid then reviews + signs
// online in the LIFF app (/chairops/m/contract). A SIGNED contract is immutable
// here too — to correct one the office must VOID it first (creates a fresh DRAFT
// next time). Company deposit account is read SERVER-SIDE (never from the form).
//
// Permissions mirror updateMaidProfile: requireRole(ADMIN) + canManageUser.

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/chairops/auth/session";
import { canManageUser } from "@/lib/chairops/auth/role-guards";
import { writeAudit } from "@/lib/chairops/audit/log";
import { isAllowedPhotoUrl } from "@/lib/chairops/utils/url-guard";
import { ChairopsUserRole } from "@/lib/generated/prisma/enums";
import type { ActionResult } from "../types";

function str(v: FormDataEntryValue | null, max = 500): string | null {
  const t = (typeof v === "string" ? v : "").trim();
  return t === "" ? null : t.slice(0, max);
}
function intOrNull(v: FormDataEntryValue | null): number | null {
  const t = (typeof v === "string" ? v : "").replace(/[, ]/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function dateOrNull(v: FormDataEntryValue | null): Date | null {
  const t = (typeof v === "string" ? v : "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  return new Date(`${t}T00:00:00Z`);
}

async function companyAccount(orgId: string) {
  const acct = await prisma.chairopsBankAccount.findFirst({
    where: { orgId, isActive: true, branchId: null },
    orderBy: { createdAt: "desc" },
    select: { bankName: true, accountNo: true, accountName: true },
  });
  return {
    companyBankName: acct?.bankName ?? null,
    companyAccountNo: acct?.accountNo ?? null,
    companyAccountName: acct?.accountName ?? "บริษัท เจพีซิงค์กรุ๊ป จำกัด",
  };
}

/** Load a MAID target in the actor's org (or null). */
async function loadMaid(orgId: string, maidId: string) {
  return prisma.chairopsUser.findFirst({
    where: { id: maidId, orgId, role: ChairopsUserRole.MAID },
  });
}

export async function adminSaveMaidContract(
  _prev: unknown,
  fd: FormData,
): Promise<ActionResult<{ id: string }>> {
  const session = await requireRole(ChairopsUserRole.ADMIN);
  const orgId = session.user.orgId;
  const maidId = str(fd.get("maidId"), 40);
  if (!maidId) return { ok: false, error: "ไม่พบรหัสแม่บ้าน" };

  const target = await loadMaid(orgId, maidId);
  if (!target) return { ok: false, error: "ไม่พบแม่บ้าน" };
  if (!canManageUser(session.user, target)) {
    return { ok: false, error: "ไม่มีสิทธิ์แก้ไขสัญญาของแม่บ้านคนนี้" };
  }

  const existing = await prisma.chairopsMaidContract.findFirst({
    where: { orgId, maidId, status: { not: "VOID" } },
    orderBy: { createdAt: "desc" },
  });
  if (existing?.status === "SIGNED") {
    return { ok: false, error: "สัญญาถูกเซ็นแล้ว — หากต้องแก้ต้องยกเลิกสัญญาก่อน" };
  }

  const nickname = str(fd.get("nickname"), 60);
  const idCardImageUrl = str(fd.get("idCardImageUrl"), 1000);
  const idCardFileName = str(fd.get("idCardFileName"), 200);
  if (idCardImageUrl && !isAllowedPhotoUrl(idCardImageUrl)) {
    return { ok: false, error: "ลิงก์รูปบัตรไม่ถูกต้อง" };
  }

  const fields = {
    maidName: str(fd.get("maidName"), 120) ?? "",
    idCardNumber: str(fd.get("idCardNumber"), 20),
    address: str(fd.get("address")),
    phone: str(fd.get("phone"), 30),
    monthlyWage: intOrNull(fd.get("monthlyWage")),
    payDayOfMonth: intOrNull(fd.get("payDayOfMonth")),
    salaryBankName: str(fd.get("salaryBankName"), 100),
    salaryAccountNo: str(fd.get("salaryAccountNo"), 40),
    salaryAccountName: str(fd.get("salaryAccountName"), 120),
    startDate: dateOrNull(fd.get("startDate")),
    endDate: dateOrNull(fd.get("endDate")),
    idCardImageUrl,
  };
  if (!fields.maidName) return { ok: false, error: "กรุณากรอกชื่อ-นามสกุลแม่บ้าน" };

  const company = await companyAccount(orgId);

  const saved = await prisma.$transaction(async (tx) => {
    const contract = existing
      ? await tx.chairopsMaidContract.update({
          where: { id: existing.id },
          data: { ...fields, ...company },
          select: { id: true },
        })
      : await tx.chairopsMaidContract.create({
          data: {
            orgId,
            maidId,
            status: "DRAFT",
            createdById: session.user.id,
            ...fields,
            ...company,
          },
          select: { id: true },
        });

    // Populate the maid profile so the LIFF sign page is prefilled + the roster
    // "บัญชี/บัตร" columns light up immediately.
    await tx.chairopsUser.update({
      where: { id: maidId },
      data: {
        nickname: nickname ?? undefined,
        idCardNumber: fields.idCardNumber ?? undefined,
        homeAddress: fields.address ?? undefined,
        idCardImageUrl: idCardImageUrl ?? undefined,
        idCardFileName: idCardFileName ?? undefined,
        bankName: fields.salaryBankName ?? undefined,
        bankAccountNo: fields.salaryAccountNo ?? undefined,
        bankAccountName: fields.salaryAccountName ?? undefined,
      },
    });

    await writeAudit(
      {
        userId: session.user.id,
        orgId,
        action: existing ? "update" : "create",
        entity: "ChairopsMaidContract",
        entityId: contract.id,
        newValue: { status: "DRAFT", maidId, maidName: fields.maidName },
        metadata: { by: "office", nickname },
      },
      tx,
    );

    return contract;
  });

  revalidatePath(`/chairops/maids/${maidId}`);
  revalidatePath(`/chairops/maids/${maidId}/contract`);
  revalidatePath("/chairops/maids");
  revalidatePath("/chairops/m/contract");
  return { ok: true, data: { id: saved.id } };
}

export async function adminVoidMaidContract(
  _prev: unknown,
  fd: FormData,
): Promise<ActionResult> {
  const session = await requireRole(ChairopsUserRole.ADMIN);
  const orgId = session.user.orgId;
  const maidId = str(fd.get("maidId"), 40);
  if (!maidId) return { ok: false, error: "ไม่พบรหัสแม่บ้าน" };

  const target = await loadMaid(orgId, maidId);
  if (!target) return { ok: false, error: "ไม่พบแม่บ้าน" };
  if (!canManageUser(session.user, target)) {
    return { ok: false, error: "ไม่มีสิทธิ์ยกเลิกสัญญาของแม่บ้านคนนี้" };
  }

  const existing = await prisma.chairopsMaidContract.findFirst({
    where: { orgId, maidId, status: { not: "VOID" } },
    orderBy: { createdAt: "desc" },
  });
  if (!existing) return { ok: false, error: "ไม่มีสัญญาให้ยกเลิก" };

  await prisma.$transaction(async (tx) => {
    await tx.chairopsMaidContract.update({
      where: { id: existing.id },
      data: { status: "VOID" },
    });
    await writeAudit(
      {
        userId: session.user.id,
        orgId,
        action: "void",
        entity: "ChairopsMaidContract",
        entityId: existing.id,
        oldValue: { status: existing.status },
        newValue: { status: "VOID" },
        metadata: { by: "office" },
      },
      tx,
    );
  });

  revalidatePath(`/chairops/maids/${maidId}`);
  revalidatePath("/chairops/maids");
  revalidatePath("/chairops/m/contract");
  return { ok: true };
}
