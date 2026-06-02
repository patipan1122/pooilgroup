// LedgerHeader — page title + บริษัท/สาขา picker, shared by every /ledger page.
// Server component: resolves the scope (companies/branches for the org) then
// renders the client picker. Title/subtitle/right-slot are page-specific.
import type { ReactNode } from "react";
import type { LedgerScope } from "../_scope";
import { CompanyBranchPicker } from "./CompanyBranchPicker";
import { LedgerLogo, LedgerEmptyState } from "@/components/ledger/Brand";

export function LedgerHeader({
  title,
  subtitle,
  scope,
  right,
}: {
  title: string;
  subtitle?: string;
  scope: LedgerScope;
  right?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {/* Small JP Sync Group logo above the page title — quiet brand presence. */}
        <LedgerLogo height={22} className="mb-1.5 opacity-90" priority />
        <h1 className="text-2xl font-bold tracking-tight text-zinc-900">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <CompanyBranchPicker
          companies={scope.companies}
          branches={scope.branches}
          companyId={scope.companyId ?? ""}
          branchId={scope.branchId ?? ""}
        />
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
