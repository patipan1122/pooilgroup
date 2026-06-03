"use client";

// VoucherMenu — "ออกเอกสาร" dropdown on the expense review pane.
//
// Opens a print-ready Thai accounting document (PV / JV / PCV / ใบแทนใบเสร็จ) in
// a new tab via GET /api/ledger/vouchers/[type]?expenseId=&company=. The route
// returns HTML that auto-fires window.print() → user saves as PDF.
//
// Guardrails (must match the route — defence in depth, the route re-checks):
//   - Documents are issued from CONFIRMED rows (drafts/void are hidden/disabled).
//   - "ใบรับรองแทนใบเสร็จ" (SUB) is only offered when there's NO real tax invoice
//     (no 13-digit vendor tax id) AND requires a typed reason before opening.

import { useEffect, useRef, useState } from "react";
import { FileText, ChevronDown, ReceiptText, BookOpen, Coins, FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

type VoucherType = "PV" | "JV" | "PCV" | "SUB";

const ITEMS: { type: VoucherType; label: string; icon: typeof FileText; hint: string }[] = [
  { type: "PV", label: "ใบสำคัญจ่าย (PV)", icon: ReceiptText, hint: "Payment Voucher" },
  { type: "JV", label: "สมุดรายวันทั่วไป (JV)", icon: BookOpen, hint: "Journal Voucher" },
  { type: "PCV", label: "ใบสำคัญจ่ายเงินสดย่อย (PCV)", icon: Coins, hint: "Petty Cash" },
  { type: "SUB", label: "ใบรับรองแทนใบเสร็จ", icon: FileWarning, hint: "เมื่อไม่มีใบกำกับภาษี" },
];

export function VoucherMenu({
  expenseId,
  companyId,
  vendorTaxId,
  disabled = false,
}: {
  expenseId: string;
  companyId: string;
  vendorTaxId: string | null;
  /** true for draft/void — documents are issued from confirmed rows only. */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // A 13-digit vendor tax id ⇒ a real tax invoice exists ⇒ no substitute receipt.
  const hasTaxInvoice = !!vendorTaxId && /^\d{13}$/.test(vendorTaxId.replace(/\D/g, ""));

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function openDoc(type: VoucherType) {
    const params = new URLSearchParams({ expenseId, company: companyId });
    if (type === "SUB") {
      const reason = window.prompt(
        "เหตุผลที่ไม่มีใบเสร็จ/ใบกำกับภาษี (จำเป็นตามกฎสรรพากร):",
        "",
      );
      if (reason == null) return; // cancelled
      if (reason.trim().length < 3) {
        alert("กรุณาระบุเหตุผลอย่างน้อย 3 ตัวอักษร");
        return;
      }
      params.set("reason", reason.trim());
    }
    setOpen(false);
    window.open(`/api/ledger/vouchers/${type}?${params.toString()}`, "_blank", "noopener");
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title={disabled ? "ยืนยันรายการก่อนจึงออกเอกสารได้" : "ออกเอกสาร PV / JV / PCV / ใบแทนใบเสร็จ"}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <FileText className="size-4" aria-hidden />
        ออกเอกสาร
        <ChevronDown className="size-3.5" aria-hidden />
      </Button>

      {open && !disabled && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1 w-64 overflow-hidden rounded-xl border border-zinc-200 bg-white py-1 shadow-lg"
        >
          {ITEMS.map(({ type, label, icon: Icon, hint }) => {
            const blocked = type === "SUB" && hasTaxInvoice;
            return (
              <button
                key={type}
                role="menuitem"
                disabled={blocked}
                onClick={() => openDoc(type)}
                title={blocked ? "รายการนี้มีเลขภาษีครบ — ใช้ใบเสร็จจริงแทน" : undefined}
                className={cn(
                  "flex w-full items-start gap-2.5 px-3 py-2 text-left text-sm",
                  blocked
                    ? "cursor-not-allowed text-zinc-300"
                    : "text-zinc-700 hover:bg-zinc-50",
                )}
              >
                <Icon className={cn("mt-0.5 size-4 shrink-0", blocked ? "text-zinc-300" : "text-[var(--color-brand-600)]")} aria-hidden />
                <span className="min-w-0">
                  <span className="block font-medium">{label}</span>
                  <span className="block text-[11px] text-zinc-400">
                    {blocked ? "มีใบกำกับภาษีแล้ว" : hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
