"use client";

// CompanyBranchPicker — บริษัท/สาขา filter ที่อยู่บนทุกหน้าใน Ledger.
// ขับเคลื่อนด้วย URL params (?company=&branch=) เพื่อให้ Server Components
// อ่าน scope ได้ตรง ๆ (ไม่ต้องใช้ client state / context).
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Building2, GitBranch } from "lucide-react";
import type { CompanyOption, BranchOption } from "@/components/ledger/_kit/types";

export function CompanyBranchPicker({
  companies,
  branches,
  companyId,
  branchId,
}: {
  companies: CompanyOption[];
  branches: BranchOption[];
  companyId: string;
  branchId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function update(next: { company?: string; branch?: string }) {
    const sp = new URLSearchParams(params.toString());
    if (next.company !== undefined) {
      if (next.company) sp.set("company", next.company);
      else sp.delete("company");
      // เปลี่ยนบริษัท → reset สาขา (สาขาผูกกับบริษัท)
      sp.delete("branch");
    }
    if (next.branch !== undefined) {
      if (next.branch) sp.set("branch", next.branch);
      else sp.delete("branch");
    }
    router.push(`${pathname}?${sp.toString()}`);
  }

  // มือถือ: บริษัท+สาขา อยู่แถวเดียว (ครึ่ง/ครึ่ง) ไม่ซ้อน 2 แถว — ประหยัดที่ (CEO 2026-06-08).
  const sel =
    "h-9 w-full rounded-lg border border-zinc-200 bg-white pl-8 pr-7 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)] sm:w-auto";

  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <div className="relative min-w-0 flex-1 sm:flex-none">
        <Building2 className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
        <select
          aria-label="เลือกบริษัท"
          value={companyId}
          onChange={(e) => update({ company: e.target.value })}
          className={sel}
        >
          {companies.length === 0 && <option value="">— ไม่มีบริษัท —</option>}
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="relative min-w-0 flex-1 sm:flex-none">
        <GitBranch className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
        <select
          aria-label="เลือกสาขา"
          value={branchId}
          onChange={(e) => update({ branch: e.target.value })}
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
    </div>
  );
}
