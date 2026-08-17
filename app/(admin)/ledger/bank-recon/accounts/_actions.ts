"use server";

// LedgerLine — Bank Account management (Settings → บัญชีธนาคาร)
// CRUD for ledger_bank_account + ledger_bank_account_company junction.
// Future-proof: lets admins add/edit/deactivate accounts without touching the DB.
//
// NOTE: no `export const runtime` here — "use server" files may only export async
// functions or Turbopack build fails. ref memory feedback-use-server-only-async.

import { requireRole } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";

const VALID_BANK_CODES = [
  "KBANK", "SCB", "TTB", "BBL", "BAAC", "KTB", "BAY", "GSB", "CIMB", "UOB", "TRUEMONEY", "OTHER",
];
const VALID_ACCOUNT_TYPES = ["savings", "current", "card_terminal"];

type Result = { ok: true } | { ok: false; error: string };

interface AccountInput {
  bankCode: string;
  accountNo: string;
  accountName: string;
  legalEntity?: string;
  flowType?: string;
  accountType?: string;
}

function validate(input: AccountInput): string | null {
  if (!VALID_BANK_CODES.includes(input.bankCode)) return "ธนาคารไม่ถูกต้อง";
  if (!input.accountNo?.trim()) return "กรุณากรอกเลขที่บัญชี";
  if (input.accountNo.length > 30) return "เลขที่บัญชียาวเกินไป";
  if (!input.accountName?.trim()) return "กรุณากรอกชื่อ/วัตถุประสงค์บัญชี";
  if (input.accountType && !VALID_ACCOUNT_TYPES.includes(input.accountType)) return "ประเภทบัญชีไม่ถูกต้อง";
  return null;
}

// ── Create ──────────────────────────────────────────────────────────────────
export async function createBankAccountAction(
  companyId: string,
  input: AccountInput,
): Promise<Result> {
  const session = await requireRole("super_admin", "org_admin", "admin", "program_admin");
  const orgId = session.user.org_id;

  const err = validate(input);
  if (err) return { ok: false, error: err };
  if (!companyId) return { ok: false, error: "ไม่พบบริษัทที่เลือก" };

  // Dup guard (natural key: org + bank + account_no)
  const dup = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM ledger_bank_account
    WHERE org_id = ${orgId}::uuid
      AND bank_code = ${input.bankCode}
      AND account_no = ${input.accountNo.trim()}
    LIMIT 1
  `;
  if (dup.length) return { ok: false, error: "มีบัญชีนี้อยู่แล้ว (ธนาคาร + เลขบัญชีซ้ำ)" };

  const accountId = randomUUID();
  try {
    await prisma.$executeRaw`
      INSERT INTO ledger_bank_account
        (id, org_id, bank_code, account_no, account_name, account_type, legal_entity, flow_type, is_active)
      VALUES (
        ${accountId}::uuid, ${orgId}::uuid,
        ${input.bankCode}, ${input.accountNo.trim()}, ${input.accountName.trim()},
        ${input.accountType ?? "savings"},
        ${input.legalEntity?.trim() || null},
        ${input.flowType?.trim() || null},
        true
      )
    `;
    await prisma.$executeRaw`
      INSERT INTO ledger_bank_account_company
        (org_id, bank_account_id, company_id, can_import, can_view)
      VALUES (${orgId}::uuid, ${accountId}::uuid, ${companyId}::uuid, true, true)
      ON CONFLICT (bank_account_id, company_id) DO NOTHING
    `;
  } catch {
    return { ok: false, error: "บันทึกไม่สำเร็จ — ลองอีกครั้ง" };
  }

  revalidatePath("/ledger/bank-recon/accounts");
  revalidatePath("/ledger/bank-recon");
  return { ok: true };
}

// ── Update ──────────────────────────────────────────────────────────────────
export async function updateBankAccountAction(
  accountId: string,
  input: AccountInput,
): Promise<Result> {
  const session = await requireRole("super_admin", "org_admin", "admin", "program_admin");
  const orgId = session.user.org_id;

  const err = validate(input);
  if (err) return { ok: false, error: err };

  // Dup guard excluding self
  const dup = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM ledger_bank_account
    WHERE org_id = ${orgId}::uuid
      AND bank_code = ${input.bankCode}
      AND account_no = ${input.accountNo.trim()}
      AND id <> ${accountId}::uuid
    LIMIT 1
  `;
  if (dup.length) return { ok: false, error: "มีบัญชีนี้อยู่แล้ว (ธนาคาร + เลขบัญชีซ้ำ)" };

  const affected = await prisma.$executeRaw`
    UPDATE ledger_bank_account SET
      bank_code = ${input.bankCode},
      account_no = ${input.accountNo.trim()},
      account_name = ${input.accountName.trim()},
      account_type = ${input.accountType ?? "savings"},
      legal_entity = ${input.legalEntity?.trim() || null},
      flow_type = ${input.flowType?.trim() || null},
      updated_at = now()
    WHERE id = ${accountId}::uuid AND org_id = ${orgId}::uuid
  `;
  if (!affected) return { ok: false, error: "ไม่พบบัญชีนี้" };

  revalidatePath("/ledger/bank-recon/accounts");
  revalidatePath("/ledger/bank-recon");
  return { ok: true };
}

// ── Toggle active (soft delete) ───────────────────────────────────────────────
export async function toggleBankAccountActiveAction(
  accountId: string,
  isActive: boolean,
): Promise<Result> {
  const session = await requireRole("super_admin", "org_admin", "admin", "program_admin");
  const orgId = session.user.org_id;

  const affected = await prisma.$executeRaw`
    UPDATE ledger_bank_account SET is_active = ${isActive}, updated_at = now()
    WHERE id = ${accountId}::uuid AND org_id = ${orgId}::uuid
  `;
  if (!affected) return { ok: false, error: "ไม่พบบัญชีนี้" };

  revalidatePath("/ledger/bank-recon/accounts");
  revalidatePath("/ledger/bank-recon");
  return { ok: true };
}
