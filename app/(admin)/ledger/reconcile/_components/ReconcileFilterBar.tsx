"use client";

// Reconcile filter bar — branch / month / vendor search. URL-driven (?branch=
// &month=&vendor=) so the Server Component re-queries with the new scope, the
// same pattern CompanyBranchPicker uses (no client data fetching). Company is
// chosen in the shared LedgerHeader picker, not here.

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { GitBranch, CalendarDays, Search, X } from "lucide-react";

interface BranchOpt {
  id: string;
  code: string;
  name: string;
}

export function ReconcileFilterBar({
  branches,
  branchId,
  month,
  vendor,
}: {
  branches: BranchOpt[];
  branchId: string;
  month: string;
  vendor: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  // Local mirror for the debounced vendor box (URL is the source of truth).
  // Sync to the prop during render (React "store info from previous render"
  // pattern) instead of an effect — avoids the set-state-in-effect cascade.
  const [vendorInput, setVendorInput] = useState(vendor);
  const [prevVendor, setPrevVendor] = useState(vendor);
  if (vendor !== prevVendor) {
    setPrevVendor(vendor);
    setVendorInput(vendor);
  }

  function pushParam(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    router.push(`${pathname}?${sp.toString()}`);
  }

  function submitVendor(e: React.FormEvent) {
    e.preventDefault();
    pushParam({ vendor: vendorInput.trim() || null });
  }

  const hasFilter = Boolean(branchId || month || vendor);
  const sel =
    "h-9 rounded-lg border border-zinc-200 bg-white pl-8 pr-7 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]";

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <div className="relative">
        <GitBranch className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
        <select
          aria-label="กรองตามสาขา"
          value={branchId}
          onChange={(e) => pushParam({ branch: e.target.value || null })}
          className={sel}
        >
          <option value="">ทุกสาขา</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.code} · {b.name}
            </option>
          ))}
        </select>
      </div>

      <div className="relative">
        <CalendarDays className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
        <input
          type="month"
          aria-label="กรองตามเดือนที่ขอโอน"
          value={month}
          onChange={(e) => pushParam({ month: e.target.value || null })}
          className="h-9 rounded-lg border border-zinc-200 bg-white pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
        />
      </div>

      <form onSubmit={submitVendor} className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
        <input
          type="search"
          aria-label="ค้นหาผู้ขาย"
          placeholder="ค้นหาผู้ขาย…"
          value={vendorInput}
          onChange={(e) => setVendorInput(e.target.value)}
          className="h-9 w-44 rounded-lg border border-zinc-200 bg-white pl-8 pr-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
        />
      </form>

      {hasFilter && (
        <button
          type="button"
          onClick={() => pushParam({ branch: null, month: null, vendor: null })}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 text-sm text-zinc-500 transition hover:bg-zinc-50"
        >
          <X className="size-3.5" aria-hidden />
          ล้างตัวกรอง
        </button>
      )}
    </div>
  );
}
