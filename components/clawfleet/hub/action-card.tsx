// ClawFleet Hub — ActionCard
// Big tappable action surface for the "ตอนนี้คุณต้องทำ X อย่าง" launcher row.
// Solid bg (per [[sticky-bg-inherit-anti-pattern]]) + colored border + Lucide icon.
// Color tone reservation follows tokens.md (rose=P0 · amber=warn · emerald=ok · indigo=admin).

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ReactNode } from "react";

type Tone = "rose" | "amber" | "emerald" | "indigo";

const toneClasses: Record<
  Tone,
  {
    surface: string;
    iconBg: string;
    iconText: string;
    cta: string;
    badge: string;
  }
> = {
  rose: {
    surface: "border-rose-200 bg-rose-50 hover:border-rose-300 hover:shadow-md",
    iconBg: "bg-rose-100",
    iconText: "text-rose-700",
    cta: "text-rose-700 group-hover:text-rose-800",
    badge: "bg-rose-600 text-white",
  },
  amber: {
    surface:
      "border-amber-200 bg-amber-50 hover:border-amber-300 hover:shadow-md",
    iconBg: "bg-amber-100",
    iconText: "text-amber-700",
    cta: "text-amber-700 group-hover:text-amber-800",
    badge: "bg-amber-600 text-white",
  },
  emerald: {
    surface:
      "border-emerald-200 bg-emerald-50 hover:border-emerald-300 hover:shadow-md",
    iconBg: "bg-emerald-100",
    iconText: "text-emerald-700",
    cta: "text-emerald-700 group-hover:text-emerald-800",
    badge: "bg-emerald-600 text-white",
  },
  indigo: {
    surface:
      "border-indigo-200 bg-indigo-50 hover:border-indigo-300 hover:shadow-md",
    iconBg: "bg-indigo-100",
    iconText: "text-indigo-700",
    cta: "text-indigo-700 group-hover:text-indigo-800",
    badge: "bg-indigo-600 text-white",
  },
};

export interface ActionCardProps {
  icon: ReactNode;
  tone: Tone;
  title: string;
  subtitle: string;
  ctaLabel: string;
  href: string;
  count?: number;
  className?: string;
}

export function ActionCard({
  icon,
  tone,
  title,
  subtitle,
  ctaLabel,
  href,
  count,
  className,
}: ActionCardProps) {
  const t = toneClasses[tone];

  return (
    <Link
      href={href}
      className={cn(
        "group block rounded-2xl border-2 p-6 transition-all shadow-sm",
        "min-h-[180px] flex flex-col justify-between",
        t.surface,
        className,
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "h-12 w-12 rounded-xl grid place-items-center flex-shrink-0",
            t.iconBg,
            t.iconText,
          )}
        >
          {icon}
        </div>
        {typeof count === "number" && count > 0 && (
          <span
            className={cn(
              "ml-auto inline-flex items-center justify-center min-w-[32px] h-7 px-2.5 rounded-full text-sm font-bold tabular-nums",
              t.badge,
            )}
          >
            {count.toLocaleString("th-TH")}
          </span>
        )}
      </div>

      <div className="mt-4">
        <h3 className="text-lg font-bold text-zinc-900 leading-tight">
          {title}
        </h3>
        <p className="mt-1 text-sm text-zinc-600">{subtitle}</p>
      </div>

      <div
        className={cn(
          "mt-4 inline-flex items-center gap-1.5 text-sm font-semibold transition-colors",
          t.cta,
        )}
      >
        <span>{ctaLabel}</span>
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}
