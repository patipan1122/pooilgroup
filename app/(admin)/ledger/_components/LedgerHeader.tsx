// LedgerHeader — page title + บริษัท/สาขา picker, shared by every /ledger page.
// Server component: resolves the scope (companies/branches for the org) then
// renders the client picker. Title/subtitle/right-slot are page-specific.
import type { ReactNode } from "react";
import type { LedgerScope } from "../_scope";
import { CompanyBranchPicker } from "./CompanyBranchPicker";
import { LedgerEmptyState } from "@/components/ledger/Brand";

export function LedgerHeader({
  title,
  subtitle,
  scope,
  right,
  scopeInFilter = false,
}: {
  title: string;
  subtitle?: string;
  scope: LedgerScope;
  right?: ReactNode;
  /** LeanUX: when the page moves บริษัท/สาขา into its ตัวกรอง popover (mobile),
   *  hide the header picker on mobile (kept on desktop where space is free). */
  scopeInFilter?: boolean;
}) {
  return (
    <div className="mb-2 flex flex-col gap-2 sm:mb-3 sm:flex-row sm:items-end sm:justify-between sm:gap-3">
      <div className="min-w-0">
        {/* JP Sync Group logo ลบออก (CEO 2026-06-09 "เอา jpsync ออก ดันทุกอย่างขึ้น · พื้นที่
            เปลือง") — บริษัทอยู่ในตัวเลือก picker ด้านขวาอยู่แล้ว · เดิม desktop-only ยังกินที่แนวตั้ง. */}
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-bold tracking-tight text-zinc-900 sm:text-2xl">
            {title}
          </h1>
          {subtitle && (
            <p className="truncate text-xs text-zinc-400 sm:hidden">{subtitle}</p>
          )}
        </div>
        {subtitle && (
          <p className="mt-0.5 hidden text-sm text-zinc-500 sm:block">{subtitle}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className={scopeInFilter ? "hidden sm:flex sm:flex-wrap sm:items-center sm:gap-2" : "contents"}>
          <CompanyBranchPicker
            companies={scope.companies}
            branches={scope.branches}
            companyId={scope.companyId ?? ""}
            branchId={scope.branchId ?? ""}
          />
        </div>
        {right}
      </div>
    </div>
  );
}

/** Shown when the org has no company yet — guides admin to settings. */
export function NoCompanyState() {
  return (
    <LedgerEmptyState
      className="min-h-[50vh]"
      mascotSize={88}
      title="ยังไม่มีบริษัทในระบบ"
      hint="เพิ่มบริษัทก่อน แล้วน้องใบเสร็จจะเริ่มช่วยจดค่าใช้จ่ายให้"
      action={
        <a
          href="/ledger/settings"
          className="text-sm font-medium text-[var(--color-brand-600)] hover:underline"
        >
          ไปหน้าตั้งค่า →
        </a>
      }
    />
  );
}
