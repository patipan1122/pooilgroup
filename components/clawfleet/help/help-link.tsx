// ClawFleet · Help link — small inline button to /clawfleet/help
// Use in workspace headers (Hub · Operations · Insights · Setup) so the manual
// is one click away from every screen.

import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface HelpLinkProps {
  /** Visual variant. "icon" = circle only · "chip" = icon + label */
  variant?: "icon" | "chip";
  className?: string;
}

export function HelpLink({ variant = "chip", className }: HelpLinkProps) {
  if (variant === "icon") {
    return (
      <Link
        href="/clawfleet/help"
        title="คู่มือการใช้งาน"
        aria-label="คู่มือการใช้งาน"
        className={cn(
          "inline-flex h-10 w-10 items-center justify-center rounded-lg",
          "border border-zinc-200 bg-white text-zinc-600",
          "hover:bg-zinc-50 hover:text-zinc-900 hover:border-zinc-300",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
          "transition-colors",
          className,
        )}
      >
        <HelpCircle className="h-5 w-5" />
      </Link>
    );
  }

  return (
    <Link
      href="/clawfleet/help"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm",
        "border border-zinc-200 bg-white text-zinc-700",
        "hover:bg-zinc-50 hover:text-zinc-900 hover:border-zinc-300",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40",
        "transition-colors",
        className,
      )}
    >
      <HelpCircle className="h-4 w-4 text-zinc-500" />
      <span>คู่มือ</span>
    </Link>
  );
}
