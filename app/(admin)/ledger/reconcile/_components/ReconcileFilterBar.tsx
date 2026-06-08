"use client";

// Reconcile filter bar — ปุ่ม "ตัวกรอง" เดียว เปิด popover: สาขา (เดี่ยว) · เดือน ·
// ผู้ขาย (เลือกได้หลายเจ้า). URL-driven (?branch=&month=&vendor=a,b,c) ให้ Server
// Component re-query เอง. บริษัทเลือกที่ LedgerHeader. แสดง chip ตัวกรองที่ใช้อยู่.

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { SlidersHorizontal, GitBranch, CalendarDays, Search, X } from "lucide-react";

interface BranchOpt {
  id: string;
  code: string;
  name: string;
}

export function ReconcileFilterBar({
  branches,
  branchId,
  month,
  vendorOptions,
  selectedVendors,
}: {
  branches: BranchOpt[];
  branchId: string;
  month: string;
  vendorOptions: string[];
  selectedVendors: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [open, setOpen] = useState(false);
  const [vendorQuery, setVendorQuery] = useState("");

  function pushParam(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) sp.set(k, v);
      else sp.delete(k);
    }
    router.push(`${pathname}?${sp.toString()}`);
  }

  function toggleVendor(v: string) {
    const set = new Set(selectedVendors);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    pushParam({ vendor: set.size ? [...set].join(",") : null });
  }

  const branchName = branches.find((b) => b.id === branchId)?.name ?? "";
  const activeCount =
    (branchId ? 1 : 0) + (month ? 1 : 0) + selectedVendors.length;

  const shownVendors = vendorQuery.trim()
    ? vendorOptions.filter((v) => v.toLowerCase().includes(vendorQuery.trim().toLowerCase()))
    : vendorOptions;

  return (
    <div className="relative mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={
            "inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition " +
            (activeCount > 0
              ? "border-[var(--color-brand-300)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
              : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50")
          }
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          ตัวกรอง
          {activeCount > 0 && (
            <span className="grid size-5 place-items-center rounded-full bg-[var(--color-brand-600)] text-[11px] font-bold text-white">
              {activeCount}
            </span>
          )}
        </button>

        {/* active chips */}
        {branchName && (
          <Chip onClear={() => pushParam({ branch: null })}>
            <GitBranch className="size-3.5" aria-hidden /> {branchName}
          </Chip>
        )}
        {month && (
          <Chip onClear={() => pushParam({ month: null })}>
            <CalendarDays className="size-3.5" aria-hidden /> {month}
          </Chip>
        )}
        {selectedVendors.map((v) => (
          <Chip key={v} onClear={() => toggleVendor(v)}>
            {v}
          </Chip>
        ))}
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => pushParam({ branch: null, month: null, vendor: null })}
            className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-zinc-500 transition hover:bg-zinc-100"
          >
            <X className="size-3.5" aria-hidden />
            ล้างทั้งหมด
          </button>
        )}
      </div>

      {open && (
        <>
          <button
            type="button"
            aria-label="ปิดตัวกรอง"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div className="absolute left-0 top-full z-40 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl">
            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-zinc-500">สาขา</label>
              <div className="relative">
                <GitBranch className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
                <select
                  aria-label="กรองตามสาขา"
                  value={branchId}
                  onChange={(e) => pushParam({ branch: e.target.value || null })}
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-8 pr-2 text-base outline-none focus:ring-2 focus:ring-[var(--color-brand-200)] sm:h-9 sm:text-sm"
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

            <div className="mb-3">
              <label className="mb-1 block text-xs font-semibold text-zinc-500">เดือนที่ขอโอน</label>
              <div className="relative">
                <CalendarDays className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
                <input
                  type="month"
                  aria-label="กรองตามเดือนที่ขอโอน"
                  value={month}
                  onChange={(e) => pushParam({ month: e.target.value || null })}
                  className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-8 pr-2 text-base outline-none focus:ring-2 focus:ring-[var(--color-brand-200)] sm:h-9 sm:text-sm"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-zinc-500">
                ผู้ขาย (เลือกได้หลายเจ้า)
              </label>
              {vendorOptions.length > 8 && (
                <div className="relative mb-1.5">
                  <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="search"
                    placeholder="ค้นหาผู้ขาย…"
                    value={vendorQuery}
                    onChange={(e) => setVendorQuery(e.target.value)}
                    className="h-10 w-full rounded-lg border border-zinc-200 bg-white pl-8 pr-2 text-base outline-none focus:ring-2 focus:ring-[var(--color-brand-200)] sm:h-9 sm:text-sm"
                  />
                </div>
              )}
              {vendorOptions.length === 0 ? (
                <p className="py-2 text-center text-xs text-zinc-400">ยังไม่มีผู้ขายในคำขอโอน</p>
              ) : (
                <ul className="max-h-52 overflow-y-auto rounded-lg border border-zinc-100">
                  {shownVendors.length === 0 ? (
                    <li className="px-2 py-3 text-center text-xs text-zinc-400">
                      ไม่พบ “{vendorQuery}”
                    </li>
                  ) : (
                    shownVendors.map((v) => {
                      const checked = selectedVendors.includes(v);
                      return (
                        <li key={v}>
                          <button
                            type="button"
                            onClick={() => toggleVendor(v)}
                            className="flex w-full items-center gap-2 px-2 py-2 text-left text-sm hover:bg-zinc-50"
                          >
                            <span
                              className={
                                "grid size-4 shrink-0 place-items-center rounded border " +
                                (checked
                                  ? "border-[var(--color-brand-600)] bg-[var(--color-brand-600)] text-white"
                                  : "border-zinc-300 bg-white")
                              }
                            >
                              {checked && <X className="size-3 rotate-45" aria-hidden />}
                            </span>
                            <span className="truncate text-zinc-700">{v}</span>
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Chip({
  children,
  onClear,
}: {
  children: React.ReactNode;
  onClear: () => void;
}) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-full bg-zinc-100 pl-2.5 pr-1 text-xs font-medium text-zinc-700">
      <span className="inline-flex items-center gap-1 truncate max-w-[160px]">{children}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label="ลบตัวกรองนี้"
        className="grid size-5 place-items-center rounded-full text-zinc-400 hover:bg-zinc-200 hover:text-zinc-600"
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}
