"use server";

// Maid employment-contract actions (CEO 2026-07-12).
//   saveContractDraft — upsert the maid's DRAFT (autosave while filling)
//   signContract      — snapshot everything + capture online signature → SIGNED
//
// Single-party signing: the maid signs; the company is pre-authorised. A SIGNED
// contract is IMMUTABLE (blocked from further edits / re-sign — idempotent). The
// company deposit account is read from org config SERVER-SIDE (never trusted
// from the client) so the maid can't alter where cash is banked.

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { requireExactRole } from "@/lib/chairops/auth/session";
import type { ActionResult } from "@/app/(admin)/chairops/(office)/maids/types";

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

// Company deposit account (where the maid banks collected cash) — org-level
// config, snapshotted onto the contract. Read server-side only.
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

function readContractFields(fd: FormData) {
  return {
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
    idCardImageUrl: str(fd.get("idCardImageUrl"), 1000),
  };
}

/** Find the maid's current (non-VOID) contract, if any. */
async function currentContract(orgId: string, maidId: string) {
  return prisma.chairopsMaidContract.findFirst({
    where: { orgId, maidId, status: { not: "VOID" } },
    orderBy: { createdAt: "desc" },
  });
}

export async function saveContractDraft(fd: FormData): Promise<ActionResult<{ id: string }>> {
  const session = await requireExactRole("MAID");
  const { orgId, id: maidId } = session.user;

  const existing = await currentContract(orgId, maidId);
  if (existing?.status === "SIGNED") {
    return { ok: false, error: "สัญญาถูกเซ็นแล้ว แก้ไขไม่ได้" };
  }

  const fields = readContractFields(fd);
  if (!fields.maidName) return { ok: false, error: "กรุณากรอกชื่อ-นามสกุล" };
  const company = await companyAccount(orgId);

  const saved = existing
    ? await prisma.chairopsMaidContract.update({
        where: { id: existing.id },
        data: { ...fields, ...company },
        select: { id: true },
      })
    : await prisma.chairopsMaidContract.create({
        data: { orgId, maidId, status: "DRAFT", createdById: maidId, ...fields, ...company },
        select: { id: true },
      });

  revalidatePath("/chairops/m/contract");
  return { ok: true, data: { id: saved.id } };
}

export async function signContract(fd: FormData): Promise<ActionResult<{ id: string }>> {
  const session = await requireExactRole("MAID");
  const { orgId, id: maidId } = session.user;

  const existing = await currentContract(orgId, maidId);
  // Idempotent — already signed ⇒ no-op success (double-submit / retry safe).
  if (existing?.status === "SIGNED") {
    return { ok: true, data: { id: existing.id } };
  }

  const fields = readContractFields(fd);
  const signatureImageUrl = str(fd.get("signatureImageUrl"), 1000);
  const signedName = str(fd.get("signedName"), 120);

  // A real, signable contract needs identity + the maid's salary account +
  // an attached ID card + the drawn signature.
  if (!fields.maidName) return { ok: false, error: "กรุณากรอกชื่อ-นามสกุล" };
  if (!fields.idCardNumber) return { ok: false, error: "กรุณากรอกเลขบัตรประชาชน" };
  if (!fields.address) return { ok: false, error: "กรุณากรอกที่อยู่" };
  if (!fields.idCardImageUrl) return { ok: false, error: "กรุณาแนบรูปบัตรประชาชน" };
  if (!fields.salaryAccountNo || !fields.salaryBankName)
    return { ok: false, error: "กรุณากรอกบัญชีรับเงินเดือน" };
  if (!signatureImageUrl) return { ok: false, error: "กรุณาเซ็นชื่อก่อนยืนยัน" };
  if (!signedName) return { ok: false, error: "กรุณาพิมพ์ชื่อผู้เซ็น" };

  const company = await companyAccount(orgId);
  const ip =
    (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  const result = await prisma.$transaction(async (tx) => {
    const data = {
      ...fields,
      ...company,
      status: "SIGNED" as const,
      signatureImageUrl,
      signedName,
      signedAt: new Date(),
      signedIp: ip,
    };
    const contract = existing
      ? await tx.chairopsMaidContract.update({
          where: { id: existing.id },
          data,
          select: { id: true },
        })
      : await tx.chairopsMaidContract.create({
          data: { orgId, maidId, createdById: maidId, ...data },
          select: { id: true },
        });

    // Sync the snapshot back to the maid profile so it stays consistent.
    await tx.chairopsUser.update({
      where: { id: maidId },
      data: {
        idCardNumber: fields.idCardNumber,
        homeAddress: fields.address,
        idCardImageUrl: fields.idCardImageUrl,
        bankName: fields.salaryBankName,
        bankAccountNo: fields.salaryAccountNo,
        bankAccountName: fields.salaryAccountName ?? undefined,
      },
    });

    return contract;
  });

  revalidatePath("/chairops/m/contract");
  revalidatePath("/chairops/m/profile");
  return { ok: true, data: { id: result.id } };
}
