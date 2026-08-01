"use client";

// LIFF (mobile) binding of ExpenseReviewPane → the MEMBER-aware actions, so a
// LINE member (field staff) can edit a draft and (if their role allows) confirm,
// instead of hitting the Pool-admin "ไม่มีสิทธิ์" wall. canConfirm comes from the
// server (the ledger_permission matrix). TRCloud push stays a web/accountant job.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Check } from "lucide-react";
import { ExpenseReviewPane } from "@/components/ledger/ExpenseReviewPane";
import type { ExpenseDraft, LedgerActionResult } from "@/components/ledger/ExpenseReviewPane";
import type { ExpenseRow, CategoryOption, BranchOption } from "@/components/ledger/_kit/types";
import type { ProjectOption } from "@/components/ledger/ProjectPicker";
import {
  liffSaveExpense,
  liffConfirmExpense,
  liffVoidExpense,
  liffSelfDeleteExpense,
  liffRequestDeleteExpense,
  setExpenseProjectAction,
} from "@/app/(admin)/ledger/_actions";
import { LiffPayeeRequest } from "./LiffPayeeRequest";
import { isTrcloudSent } from "@/lib/ledger/trcloud-state";

/** ขอโอนเงินบนมือถือ (payment.request) — คำนวณสิทธิ์/สถานะฝั่ง server ใน page.tsx.
 *  ไม่ส่งมา = ไม่มีปุ่มขอโอน (พนักงานหน้างานไม่มีสิทธิ์). */
type PayoutProps = {
  expenseId: string;
  companyId: string;
  /** มีสิทธิ์ payment.request ไหม — ไม่มี = ไม่โชว์ปุ่ม. */
  canRequest: boolean;
  /** ตั้งสาขา+หมวดครบไหม — ยังไม่ครบ modal จะเตือน + ปิดปุ่มส่ง. */
  classified: boolean;
  /** มีคำขอโอน active ของบิลนี้อยู่แล้วไหม — มีแล้ว = ปุ่มเป็น "✅ ขอโอนแล้ว". */
  alreadyRequested: boolean;
};

export function LiffExpensePane({
  expense,
  replacement,
  categories,
  branches,
  canConfirm,
  canSendTrcloud = false,
  currentUserId,
  backHref,
  projects,
  payout,
}: {
  expense: ExpenseRow;
  replacement?: ExpenseRow | null;
  categories: CategoryOption[];
  branches: BranchOption[];
  canConfirm: boolean;
  /** ขอโอนเงินบนมือถือ — ปุ่มโผล่ข้าง "บันทึกรายการ" (CEO 2026-08-01). */
  payout?: PayoutProps | null;
  /** true = actor เป็นบัญชี/ผู้ดูแล (สิทธิ์ expense.export) → โชว์ปุ่ม "ส่ง TRCloud" บนมือถือ.
   *  พนักงานหน้างาน = false → ไม่เห็นปุ่มบัญชี (ใส่หมวด/สาขาได้เหมือนเดิม). */
  canSendTrcloud?: boolean;
  /** โครงการ (F2) active ของบริษัทนี้ — ไม่ส่งมา = ซ่อนช่องโครงการ. */
  projects?: ProjectOption[];
  /** Pool user id ของ actor (actor.userId) — ใช้ตัดสิน self-delete (ลบเอง) vs ขอลบ. */
  currentUserId?: string | null;
  /** หน้าที่จะเด้งกลับหลังยืนยัน/ลบสำเร็จ (รายการ "ใบของฉัน"). */
  backHref: string;
}) {
  const router = useRouter();
  const [payoutOpen, setPayoutOpen] = useState(false);
  return (
    <>
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
      // แท็ก "โครงการ" — สมาชิกไลน์แท็กบิลตัวเองได้ (own-row gate ฝั่ง server). ไม่แตะ ขอโอน.
      projects={projects}
      onSetProject={(id: string, projectId: string | null): Promise<LedgerActionResult> =>
        setExpenseProjectAction(id, projectId)
      }
      // ภาษีซื้อ override + แนบใบทดแทน = งานบัญชีฝั่งเว็บ (gate expense.confirm/Pool session).
      // LIFF (สมาชิก/หน้างาน) เห็นสถานะสี "ผิดตรงไหน" อ่านอย่างเดียว — ไม่โชว์ปุ่มแก้.
      canEditClaimability={false}
      // ส่ง TRCloud บนมือถือ (CEO 2026-07-26 · โมบายฟังก์ชัน) — เฉพาะบัญชี/ผู้ดูแล:
      //   showTrcloud/showSendToTrcloud = canSendTrcloud → ปุ่ม "ส่งเข้า TRCloud" มีป้ายชื่อ
      //   ที่ header (พนักงาน=false → ไม่เห็น). showVoucherMenu=false → ไม่ปล่อยเมนู "ออกเอกสาร"
      //   (PV/JV/ใบแทน · งานบัญชีหนัก) มารกบนมือถือ. gate ตรงกับ sendExpenseToTrcloud
      //   (ledgerWebCanForRole · expense.export) → ปุ่มที่โชว์ = กดผ่านจริง.
      showTrcloud={canSendTrcloud}
      showSendToTrcloud={canSendTrcloud}
      showVoucherMenu={false}
      // ยืนยันแล้ว → อยู่หน้าบิลนั้นเลย (refresh ให้เห็นสถานะยืนยัน · ไม่เด้งไป home/รายการ
      // = ตอบ CEO 2026-07-09 "ควรไปหน้าบิลนั้น ไม่ใช่เด้ง home ใหญ่") · ลบ/ยกเลิก → เด้งกลับรายการ
      // (บิลหายจากหน้านี้แล้ว อยู่ต่อไม่มีอะไรให้ดู).
      onAfterFinish={(action) => {
        if (action === "delete" || action === "void") {
          router.push(backHref);
        }
        router.refresh();
      }}
      // ปุ่ม "ขอโอน" ข้างปุ่มบันทึกรายการ (CEO 2026-08-01) — เดิมอยู่ล่างสุดใต้ฟอร์ม เลื่อนไม่เจอ.
      // มีสิทธิ์ payment.request เท่านั้นถึงเห็น · ขอแล้ว = ปุ่มเป็น "✅ ขอโอนแล้ว" กดซ้ำไม่ได้.
      footerExtra={
        payout?.canRequest ? (
          payout.alreadyRequested ? (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm font-semibold text-emerald-700">
              <Check className="size-4" aria-hidden /> ขอโอนแล้ว
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setPayoutOpen(true)}
              className="press inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white active:bg-violet-700 sm:flex-none"
            >
              <Banknote className="size-4" aria-hidden /> ขอโอน
            </button>
          )
        ) : undefined
      }
    />
      {payout && (
        <LiffPayeeRequest
          expenseId={payout.expenseId}
          companyId={payout.companyId}
          classified={payout.classified}
          canSendTrcloud={canSendTrcloud}
          poSent={isTrcloudSent(expense.trcloudDocId)}
          open={payoutOpen}
          onOpenChange={setPayoutOpen}
        />
      )}
    </>
  );
}
