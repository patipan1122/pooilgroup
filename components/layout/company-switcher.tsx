"use client";

// Company switcher — sits in the top header next to the module switcher.
// Persists selection to cookie + reflects in URL (?company=) so server pages
// pick it up. Visible everywhere; affects all pages that read company filter.

import { useState, useTransition, useRef, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Building2, Check, ChevronDown, Layers } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { COMPANY_COOKIE_NAME, COMPANY_COOKIE_MAX_AGE } from "@/lib/auth/company-context-shared";

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

  const current = currentCompanyId
    ? companies.find((c) => c.id === currentCompanyId)
    : null;

  function pick(companyId: string | null) {
    setCompanyCookie(companyId ?? "all");
    setOpen(false);
    // Update URL param so the current page re-renders with the new filter
    const params = new URLSearchParams(searchParams.toString());
    if (companyId) params.set("company", companyId);
    else params.delete("company");
    const qs = params.toString();
    startTransition(() => {
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`);
      router.refresh();
    });
  }

  return (
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
          {current ? (
            <Building2 className="size-3.5 text-[var(--color-brand-700)]" />
          ) : (
            <Layers className="size-3.5 text-[var(--color-brand-700)]" />
          )}
        </div>
        <div className="text-left hidden sm:block min-w-0">
          <div className="text-xs font-bold text-zinc-500 leading-none">
            บริษัท
          </div>
          <div className="text-sm font-bold leading-tight truncate max-w-[140px]">
            {current ? current.name : "ทั้งหมด"}
          </div>
        </div>
        <ChevronDown className="size-4 text-zinc-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 w-64 bg-white rounded-2xl border-2 border-zinc-200 shadow-pop p-1.5 z-30">
          <p className="px-3 pt-2 pb-1 text-xs font-bold text-zinc-500">
            เลือกบริษัทที่จะดู
          </p>
          <button
            type="button"
            onClick={() => pick(null)}
            className={cn(
              "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl transition-colors text-left",
              !current
                ? "bg-[var(--color-brand-50)]"
                : "hover:bg-zinc-50",
            )}
          >
            <div className="size-8 rounded-lg bg-zinc-100 flex items-center justify-center shrink-0">
              <Layers className="size-4 text-zinc-600" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">ทั้งหมด</div>
              <div className="text-[11px] text-zinc-500">รวมทุกบริษัท</div>
            </div>
            {!current && (
              <Check className="size-4 text-[var(--color-brand-600)] shrink-0" />
            )}
          </button>
          <div className="h-px bg-zinc-100 my-1.5" />
          {companies.map((c) => {
            const isCurrent = c.id === currentCompanyId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => pick(c.id)}
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
  );
}
