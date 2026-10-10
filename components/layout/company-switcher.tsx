"use client";

// Company switcher — sits in the top header next to the module switcher.
// Persists selection to cookie + reflects in URL (?company=) so server pages
// pick it up. Visible everywhere; affects all pages that read company filter.
//
// CEO decision 2026-10-10: removed the "ทั้งหมด" (view-all) option — every
// page must always be scoped to exactly one concrete company, no combined
// view survives anywhere. `currentCompanyId` is now always a real company id
// (lib/auth/company-context.ts's resolveCompanyFilter() never returns
// undefined/"all" anymore), so this component only ever switches BETWEEN
// companies, never into/out of a blended view.

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Building2, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { COMPANY_COOKIE_NAME, COMPANY_COOKIE_MAX_AGE } from "@/lib/auth/company-context-shared";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface Company {
  id: string;
  code: string;
  name: string;
}

interface Props {
  companies: Company[];
  currentCompanyId?: string;
}

function setCompanyCookie(value: string) {
  if (typeof document === "undefined") return;
  document.cookie = `${COMPANY_COOKIE_NAME}=${value}; path=/; max-age=${COMPANY_COOKIE_MAX_AGE}; samesite=lax`;
}

export function CompanySwitcher({ companies, currentCompanyId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [pendingPick, setPendingPick] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [, startTransition] = useTransition();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  if (companies.length < 2) return null;

  // currentCompanyId (server-passed prop) only ever reflects the COOKIE —
  // app/(admin)/layout.tsx can't see the URL's ?company= because Next.js
  // layouts don't receive searchParams (only pages do), so it resolves with
  // urlParam=undefined. The page CONTENT below this header uses
  // resolveCompanyFilter(orgId, sp.company) and correctly prefers the URL
  // param over the cookie. Without this override, a direct link/bookmark
  // with ?company=<A> while the cookie is still on <B> would show page data
  // for A under a header pill labeled B — a wrong, concrete company name,
  // not the old benign "ทั้งหมด" fallback (bug found testing this fix
  // 2026-10-10). Re-derive the same URL > cookie precedence client-side so
  // the pill always names the company the page is actually showing.
  const urlCompanyId = searchParams.get("company");
  const effectiveCompanyId =
    urlCompanyId && companies.some((c) => c.id === urlCompanyId)
      ? urlCompanyId
      : currentCompanyId;
  const current =
    (effectiveCompanyId
      ? companies.find((c) => c.id === effectiveCompanyId)
      : null) ?? companies[0];

  // ขอสลับ → เปิดหน้าต่างยืนยันก่อน (กันสลับพลาด/ข้อมูลปนกัน · CEO 2026-07-25).
  // เลือกอันเดิม = ไม่ต้องยืนยัน แค่ปิดเมนู.
  function requestPick(companyId: string, name: string) {
    setOpen(false);
    if (companyId === current.id) return;
    setPendingPick({ id: companyId, name });
  }

  // สลับจริง (หลังยืนยัน) — เขียนคุกกี้ + อัปเดต ?company= แล้ว refresh ทั้งหน้า.
  function doPick(companyId: string) {
    setCompanyCookie(companyId);
    // Update URL param so the current page re-renders with the new filter
    const params = new URLSearchParams(searchParams.toString());
    params.set("company", companyId);
    const qs = params.toString();
    startTransition(() => {
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`);
      router.refresh();
    });
  }

  return (
    <>
    <div className="relative" ref={wrapperRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-zinc-100 transition-colors min-w-0",
          open && "bg-zinc-100",
        )}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <div className="size-7 rounded-lg bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] flex items-center justify-center shrink-0">
          <Building2 className="size-3.5 text-[var(--color-brand-700)]" />
        </div>
        <div className="text-left hidden sm:block min-w-0">
          <div className="text-xs font-bold text-zinc-500 leading-none">
            บริษัท
          </div>
          <div className="text-sm font-bold leading-tight truncate max-w-[140px]">
            {current.name}
          </div>
        </div>
        <ChevronDown className="size-4 text-zinc-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-64 bg-white rounded-2xl border-2 border-zinc-200 shadow-pop p-1.5 z-30">
          <p className="px-3 pt-2 pb-1 text-xs font-bold text-zinc-500">
            เลือกบริษัทที่จะดู
          </p>
          {companies.map((c) => {
            const isCurrent = c.id === current.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => requestPick(c.id, c.name)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-colors text-left",
                  isCurrent
                    ? "bg-[var(--color-brand-50)]"
                    : "hover:bg-zinc-50",
                )}
              >
                <div className="size-8 rounded-lg bg-[var(--color-brand-50)] border border-[var(--color-brand-200)] flex items-center justify-center shrink-0">
                  <Building2 className="size-4 text-[var(--color-brand-700)]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{c.name}</div>
                  <div className="text-[11px] text-zinc-500 font-mono">
                    {c.code}
                  </div>
                </div>
                {isCurrent && (
                  <Check className="size-4 text-[var(--color-brand-600)] shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>

    <Dialog
      open={!!pendingPick}
      onClose={() => setPendingPick(null)}
      title="ยืนยันเปลี่ยนบริษัท"
    >
      <div className="space-y-5">
        <div className="text-sm text-zinc-700 leading-relaxed">
          สลับไปดูข้อมูลของ{" "}
          <span className="font-bold text-zinc-900">{pendingPick?.name}</span>?
          <br />
          ข้อมูลทุกหน้าจะเปลี่ยนไปตามบริษัทนี้ (ประกาศ · ผู้สมัคร · เอกสาร ฯลฯ)
        </div>
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
          <Button variant="ghost" onClick={() => setPendingPick(null)}>
            ยกเลิก
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (pendingPick) doPick(pendingPick.id);
              setPendingPick(null);
            }}
          >
            เปลี่ยนบริษัท
          </Button>
        </div>
      </div>
    </Dialog>
    </>
  );
}
