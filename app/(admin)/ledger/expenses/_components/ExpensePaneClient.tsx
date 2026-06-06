"use client";

// Binds the server actions to ExpenseReviewPane. Kept as a thin client wrapper
// so the page (server component) can pass the serialised expense + options.
import { ExpenseReviewPane } from "@/components/ledger/ExpenseReviewPane";
import type {
  ExpenseDraft,
  LedgerActionResult,
} from "@/components/ledger/ExpenseReviewPane";
import type { ExpenseRow, CategoryOption, BranchOption } from "@/components/ledger/_kit/types";
import {
  saveExpense,
  confirmExpense,
  voidExpense,
  overrideClaimability,
  attachReplacementInvoice,
} from "../../_actions";

export function ExpensePaneClient({
  expense,
  replacement,
  categories,
  branches,
  canEditClaimability = false,
}: {
  expense: ExpenseRow;
  replacement?: ExpenseRow | null;
  categories: CategoryOption[];
  branches: BranchOption[];
  /** นักบัญชี/แอดมิน → ปรับ "ขอคืนได้?" + แนบใบทดแทนได้ (gate เดียวกับ confirm). */
  canEditClaimability?: boolean;
}) {
  return (
    <ExpenseReviewPane
      expense={expense}
      replacement={replacement}
      categories={categories}
      branches={branches}
      canEditClaimability={canEditClaimability}
      onSave={(id: string, patch: ExpenseDraft): Promise<LedgerActionResult> =>
        saveExpense(id, patch)
      }
      onConfirm={(id: string, patch: ExpenseDraft): Promise<LedgerActionResult> =>
        confirmExpense(id, patch)
      }
      onVoid={(id: string): Promise<LedgerActionResult> => voidExpense(id)}
      onOverrideClaimability={(raw) => overrideClaimability(raw)}
      onAttachReplacement={(raw) => attachReplacementInvoice(raw)}
    />
  );
}
