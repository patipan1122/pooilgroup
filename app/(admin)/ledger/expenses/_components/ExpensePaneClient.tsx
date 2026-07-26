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
import type { ProjectOption } from "@/components/ledger/ProjectPicker";
import {
  saveExpense,
  confirmExpense,
  voidExpense,
  overrideClaimability,
  attachReplacementInvoice,
  selfDeleteExpense,
  requestDeleteExpense,
  ensureCentralBranch,
  createPaymentRequestAction,
  setExpenseProjectAction,
  updateExpenseInTrcloud,
} from "../../_actions";

export function ExpensePaneClient({
  expense,
  replacement,
  categories,
  branches,
  canEditClaimability = false,
  currentUserId,
  payreqEnabled = false,
  showSendToTrcloud = true,
  projects,
}: {
  expense: ExpenseRow;
  replacement?: ExpenseRow | null;
  categories: CategoryOption[];
  branches: BranchOption[];
  /** โครงการ (F2) active ของบริษัทนี้ — ไม่ส่งมา = ซ่อนช่องโครงการ. */
  projects?: ProjectOption[];
  /** นักบัญชี/แอดมิน → ปรับ "ขอคืนได้?" + แนบใบทดแทนได้ (gate เดียวกับ confirm). */
  canEditClaimability?: boolean;
  /** Pool user id ของคนที่ล็อกอิน — ใช้ตัดสิน self-delete (ลบเอง) vs ขอลบ. */
  currentUserId?: string | null;
  /** LEDGER_PAYREQ_V1 — โชว์ปุ่ม "ขอโอน" ในแถบล่างของแผงรายละเอียด. */
  payreqEnabled?: boolean;
  /** false = ซ่อนปุ่ม "ส่ง TRCloud" ในแผง (ใช้ปุ่มรวม TrcloudButton นอกแผงแทน). */
  showSendToTrcloud?: boolean;
}) {
  const router = useRouter();
  return (
    <ExpenseReviewPane
      expense={expense}
      replacement={replacement}
      categories={categories}
      branches={branches}
      canEditClaimability={canEditClaimability}
      showSendToTrcloud={showSendToTrcloud}
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
      projects={projects}
      onSetProject={(id: string, projectId: string | null): Promise<LedgerActionResult> =>
        setExpenseProjectAction(id, projectId)
      }
      onRequestPayout={
        payreqEnabled
          ? (payee): Promise<LedgerActionResult> =>
              createPaymentRequestAction([expense.id], payee)
          : undefined
      }
      // แก้บิลหลังส่ง TRCloud + sync (CEO 2026-07-26) — accountant-tier เท่านั้น (server ตรวจซ้ำ).
      onUpdateTrcloud={
        canEditClaimability
          ? (id: string) => updateExpenseInTrcloud(id)
          : undefined
      }
      currentUserId={currentUserId}
      // เว็บ (master-detail) — refresh ให้รายการอัปเดตสถานะหลังยืนยัน/ลบ.
      onAfterFinish={() => router.refresh()}
    />
  );
}
