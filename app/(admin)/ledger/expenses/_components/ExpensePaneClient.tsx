"use client";

// Binds the server actions to ExpenseReviewPane. Kept as a thin client wrapper
// so the page (server component) can pass the serialised expense + options.
import { ExpenseReviewPane } from "@/components/ledger/ExpenseReviewPane";
import type {
  ExpenseDraft,
  LedgerActionResult,
} from "@/components/ledger/ExpenseReviewPane";
import type { ExpenseRow, CategoryOption, BranchOption } from "@/components/ledger/_kit/types";
import { saveExpense, confirmExpense, voidExpense } from "../../_actions";

export function ExpensePaneClient({
  expense,
  categories,
  branches,
}: {
  expense: ExpenseRow;
  categories: CategoryOption[];
  branches: BranchOption[];
}) {
  return (
    <ExpenseReviewPane
      expense={expense}
      categories={categories}
      branches={branches}
      onSave={(id: string, patch: ExpenseDraft): Promise<LedgerActionResult> =>
        saveExpense(id, patch)
      }
      onConfirm={(id: string, patch: ExpenseDraft): Promise<LedgerActionResult> =>
        confirmExpense(id, patch)
      }
      onVoid={(id: string): Promise<LedgerActionResult> => voidExpense(id)}
    />
  );
}
