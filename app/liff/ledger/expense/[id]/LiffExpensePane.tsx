"use client";

// LIFF (mobile) binding of ExpenseReviewPane → the MEMBER-aware actions, so a
// LINE member (field staff) can edit a draft and (if their role allows) confirm,
// instead of hitting the Pool-admin "ไม่มีสิทธิ์" wall. canConfirm comes from the
// server (the ledger_permission matrix). TRCloud push stays a web/accountant job.
import { ExpenseReviewPane } from "@/components/ledger/ExpenseReviewPane";
import type { ExpenseDraft, LedgerActionResult } from "@/components/ledger/ExpenseReviewPane";
import type { ExpenseRow, CategoryOption, BranchOption } from "@/components/ledger/_kit/types";
import {
  liffSaveExpense,
  liffConfirmExpense,
  liffVoidExpense,
  liffSelfDeleteExpense,
  liffRequestDeleteExpense,
} from "@/app/(admin)/ledger/_actions";

export function LiffExpensePane({
  expense,
  replacement,
  categories,
  branches,
  canConfirm,
  currentUserId,
}: {
  expense: ExpenseRow;
  replacement?: ExpenseRow | null;
  categories: CategoryOption[];
  branches: BranchOption[];
  canConfirm: boolean;
  /** Pool user id ของ actor (actor.userId) — ใช้ตัดสิน self-delete (ลบเอง) vs ขอลบ. */
  currentUserId?: string | null;
}) {
  return (
    <ExpenseReviewPane
      expense={expense}
      replacement={replacement}
      categories={categories}
      branches={branches}
      onSave={(id: string, patch: ExpenseDraft): Promise<LedgerActionResult> => liffSaveExpense(id, patch)}
      onConfirm={(id: string, patch: ExpenseDraft): Promise<LedgerActionResult> => liffConfirmExpense(id, patch)}
      onVoid={(id: string): Promise<LedgerActionResult> => liffVoidExpense(id)}
      onSelfDelete={(id: string): Promise<LedgerActionResult> => liffSelfDeleteExpense(id)}
      onRequestDelete={(id: string, reason?: string): Promise<LedgerActionResult> =>
        liffRequestDeleteExpense(id, reason)
      }
      currentUserId={currentUserId}
      canConfirm={canConfirm}
      // ภาษีซื้อ override + แนบใบทดแทน = งานบัญชีฝั่งเว็บ (gate expense.confirm/Pool session).
      // LIFF (สมาชิก/หน้างาน) เห็นสถานะสี "ผิดตรงไหน" อ่านอย่างเดียว — ไม่โชว์ปุ่มแก้.
      canEditClaimability={false}
      showTrcloud={false}
    />
  );
}
