"use client";

// PROJECT RULE: All "back" UI uses browser history (router.back), never a
// hardcoded Link to a parent route. See memory: feedback_back_button_browser_history.
// If a page is reached via direct URL (no history), pass `fallbackHref`.

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface Props {
  /** Visible label, e.g. "กลับ" or "กลับไปยังรายการ" */
  label?: string;
  /** Used only when there is no history to go back to (direct landing) */
  fallbackHref?: string;
  className?: string;
}

export function BackButton({
  label = "กลับ",
  fallbackHref,
  className,
}: Props) {
  const router = useRouter();

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
      return;
    }
    if (fallbackHref) router.push(fallbackHref);
  }

  const baseClass = cn(
    "inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-zinc-500 hover:text-[var(--color-brand-700)] transition-colors",
    className,
  );

  // SSR-safe fallback as <Link> when no history (avoids hydration mismatch)
  if (!fallbackHref) {
    return (
      <button type="button" onClick={handleBack} className={baseClass}>
        <ArrowLeft className="size-3.5" />
        {label}
      </button>
    );
  }

  return (
    <button type="button" onClick={handleBack} className={baseClass}>
      <ArrowLeft className="size-3.5" />
      {label}
      {/* hidden link for SEO/no-JS */}
      <Link href={fallbackHref} className="sr-only">
        {label}
      </Link>
    </button>
  );
}
