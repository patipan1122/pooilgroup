// LedgerHeader — page title + บริษัท/สาขา picker, shared by every /ledger page.
// Server component: resolves the scope (companies/branches for the org) then
// renders the client picker. Title/subtitle/right-slot are page-specific.
import type { ReactNode } from "react";
import type { LedgerScope } from "../_scope";
import { CompanyBranchPicker } from "./CompanyBranchPicker";

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
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
      <div className="text-4xl">🏢</div>
      <p className="text-sm text-zinc-500">
        ยังไม่มีบริษัทในระบบ — เพิ่มบริษัทก่อนเริ่มใช้งานบัญชี
      </p>
      <a
        href="/ledger/settings"
        className="text-sm font-medium text-[var(--color-brand-600)] hover:underline"
      >
        ไปหน้าตั้งค่า →
      </a>
    </div>
  );
}
