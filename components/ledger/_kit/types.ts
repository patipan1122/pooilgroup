// Shared UI types for the Ledger admin surfaces.
//
// Source of truth = Partition B's `lib/ledger/types.ts` + `queries.ts`. We
// re-export / alias those here so the UI kit and the data layer agree on shape
// (one source of truth — avoids drift after the cross-org-leak audits).

import type { Expense, ExpenseItem, ExpenseStatus, ExpenseSource } from "@/lib/ledger/types";

/** Canonical client-safe expense row (Decimals already → number by B's serializer). */
export type ExpenseRow = Expense;
export type ExpenseItemRow = ExpenseItem;
export type LedgerStatusValue = ExpenseStatus;
export type LedgerSourceValue = ExpenseSource;

/** Category option — matches `listCategories()` select in queries.ts. */
export type CategoryOption = {
  id: string;
  name: string;
  color: string | null;
  trcloudAccCode?: string | null;
  sort: number;
};

/** Branch / company option — matches `listBranches()` / `listCompanies()`. */
export type BranchOption = {
  id: string;
  code: string;
  name: string;
};

export type CompanyOption = {
  id: string;
  code: string;
  name: string;
};

/** Budget row with used-vs-cap computed (see _data.ts listBudgets). */
export type BudgetRow = {
  id: string;
  categoryId: string;
  categoryName: string | null;
  branchId: string | null;
  branchName: string | null;
  period: string;
  recurring: boolean;
  amount: number;
  alertPct: number;
  used: number;
};
