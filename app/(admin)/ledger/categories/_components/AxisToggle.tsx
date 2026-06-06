// Axis toggle + branch selector for the category ledger book.
//
// CEO's two views:
//   • หมวด        → whole company total for this category over time
//   • หมวด × สาขา → e.g. "ค่าไฟ ของสาขา A" — pick ONE branch
//
// URL-driven (no client state store): toggling rewrites ?axis= / ?b= on the same
// route so the server re-queries categoryLedger with the right branch pin. Keeps
// the page a server component; this client island only pushes navigations.
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils/cn";

interface BranchOpt {
  id: string;
  name: string;
}

export function AxisToggle({
  axis,
  branchId,
  branches,
}: {
  axis: "category" | "branch";
  branchId: string | null;
  branches: BranchOpt[];
}) {
  const router = useRouter();
  const sp = useSearchParams();

  const setParam = (next: Record<string, string | null>) => {
    const params = new URLSearchParams(sp?.toString() ?? "");
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    const qs = params.toString();
    router.push(qs ? `?${qs}` : "?", { scroll: false });
  };

  const selectAxis = (a: "category" | "branch") => {
    if (a === "category") {
      // Whole-company view → drop the branch pin.
      setParam({ axis: null, b: null });
    } else {
      // ×สาขา view → default to the first branch if none chosen yet.
      const b = branchId ?? branches[0]?.id ?? null;
      setParam({ axis: "branch", b });
    }
  };

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      {/* segmented axis toggle */}
      <div
        role="tablist"
        aria-label="มุมมองสมุดค่าใช้จ่าย"
        className="inline-flex rounded-xl border border-zinc-200 bg-zinc-50 p-1"
      >
        {(
          [
            { key: "category", label: "หมวด" },
            { key: "branch", label: "หมวด × สาขา" },
          ] as const
        ).map((opt) => {
          const active = axis === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectAxis(opt.key)}
              className={cn(
                "min-h-[40px] rounded-lg px-4 text-sm font-medium transition-colors",
                active
                  ? "bg-white text-[var(--color-brand-700)] shadow-sm ring-1 ring-zinc-200"
                  : "text-zinc-500 hover:text-zinc-800",
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* branch selector — only when axis = ×สาขา */}
      {axis === "branch" && (
        <label className="flex items-center gap-2">
          <span className="sr-only">เลือกสาขา</span>
          <select
            value={branchId ?? ""}
            onChange={(e) => setParam({ axis: "branch", b: e.target.value || null })}
            className="min-h-[40px] rounded-xl border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-800 focus:border-[var(--color-brand-400)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
          >
            {branches.length === 0 && <option value="">ยังไม่มีสาขา</option>}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
