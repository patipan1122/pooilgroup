"use client";

// LIFF (mobile) binding of ExpenseReviewPane → the MEMBER-aware actions, so a
// LINE member (field staff) can edit a draft and (if their role allows) confirm,
// instead of hitting the Pool-admin "ไม่มีสิทธิ์" wall. canConfirm comes from the
// server (the ledger_permission matrix). TRCloud push stays a web/accountant job.
import { ExpenseReviewPane } from "@/components/ledger/ExpenseReviewPane";
import type { ExpenseDraft, LedgerActionResult } from "@/components/ledger/ExpenseReviewPane";
import type { ExpenseRow, CategoryOption, BranchOption } from "@/components/ledger/_kit/types";
import { liffSaveExpense, liffConfirmExpense, liffVoidExpense } from "@/app/(admin)/ledger/_actions";

export function LiffExpensePane({
  expense,
  categories,
  branches,
  canConfirm,
}: {
  expense: ExpenseRow;
  categories: CategoryOption[];
  branches: BranchOption[];
  canConfirm: boolean;
}) {
  return (
    <ExpenseReviewPane
      expense={expense}
      categories={categories}
      branches={branches}
      onSave={(id: string, patch: ExpenseDraft): Promise<LedgerActionResult> => liffSaveExpense(id, patch)}
      onConfirm={(id: string, patch: ExpenseDraft): Promise<LedgerActionResult> => liffConfirmExpense(id, patch)}
      onVoid={(id: string): Promise<LedgerActionResult> => liffVoidExpense(id)}
      canConfirm={canConfirm}
      showTrcloud={false}
    />
  );
}
