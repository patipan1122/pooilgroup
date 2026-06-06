"use client";

// Binds the server actions to ExpenseReviewPane. Kept as a thin client wrapper
// so the page (server component) can pass the serialised expense + options.
import { useRouter } from "next/navigation";
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
  selfDeleteExpense,
  requestDeleteExpense,
  ensureCentralBranch,
} from "../../_actions";

export function ExpensePaneClient({
  expense,
  replacement,
  categories,
  branches,
  canEditClaimability = false,
  currentUserId,
}: {
  expense: ExpenseRow;
  replacement?: ExpenseRow | null;
  categories: CategoryOption[];
  branches: BranchOption[];
  /** นักบัญชี/แอดมิน → ปรับ "ขอคืนได้?" + แนบใบทดแทนได้ (gate เดียวกับ confirm). */
  canEditClaimability?: boolean;
  /** Pool user id ของคนที่ล็อกอิน — ใช้ตัดสิน self-delete (ลบเอง) vs ขอลบ. */
  currentUserId?: string | null;
}) {
  const router = useRouter();
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
      onSelfDelete={(id: string): Promise<LedgerActionResult> => selfDeleteExpense(id)}
      onRequestDelete={(id: string, reason?: string): Promise<LedgerActionResult> =>
        requestDeleteExpense(id, reason)
      }
      onEnsureCentralBranch={(companyId: string) => ensureCentralBranch(companyId)}
      currentUserId={currentUserId}
      // เว็บ (master-detail) — refresh ให้รายการอัปเดตสถานะหลังยืนยัน/ลบ.
      onAfterFinish={() => router.refresh()}
    />
  );
}
