// ClawFleet Hub — KpiStrip
// Server Component · 6-tile horizontal KPI strip for the hub workspace.
// Mobile: 2x3 grid · Tablet: 3x2 · Desktop: 6x1.
// Each tile uses solid bg-white · ring-1 ring-zinc-200 · rounded-2xl (per tokens.md).
//
// Tile is optionally clickable (becomes <Link> when href provided).
// Numbers `tabular-nums` to avoid width jitter. No translucent backgrounds.

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ReactNode } from "react";

export type KpiSeverity = "neutral" | "success" | "warning" | "danger" | "info";

const severityClasses: Record<
  KpiSeverity,
  { iconBg: string; iconText: string; valueText: string; subText: string }
> = {
  neutral: {
    iconBg: "bg-zinc-100",
    iconText: "text-zinc-700",
    valueText: "text-zinc-900",
    subText: "text-zinc-500",
  },
  success: {
    iconBg: "bg-emerald-100",
    iconText: "text-emerald-700",
    valueText: "text-emerald-800",
    subText: "text-emerald-700",
  },
  warning: {
    iconBg: "bg-amber-100",
    iconText: "text-amber-700",
    valueText: "text-amber-800",
    subText: "text-amber-700",
  },
  danger: {
    iconBg: "bg-rose-100",
    iconText: "text-rose-700",
    valueText: "text-rose-800",
    subText: "text-rose-700",
  },
  info: {
    iconBg: "bg-indigo-100",
    iconText: "text-indigo-700",
    valueText: "text-indigo-800",
    subText: "text-indigo-700",
  },
};

export interface KpiStripItem {
  key: string;
  icon: ReactNode;
  label: string;
  /** Formatted display value (e.g. "฿12,450" or "3") */
  value: string | number;
  /** Optional helper line below value */
  sub?: string;
  severity?: KpiSeverity;
  /** When set, the tile renders as a Link */
  href?: string;
}

export interface KpiStripProps {
  items: KpiStripItem[];
  className?: string;
}

export function KpiStrip({ items, className }: KpiStripProps) {
  return (
    <div
      className={cn(
        "grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6",
        className,
      )}
      role="list"
      aria-label="สรุปวันนี้"
    >
      {items.map((item) => (
        <KpiCell key={item.key} item={item} />
      ))}
    </div>
  );
}

function KpiCell({ item }: { item: KpiStripItem }) {
  const sev = severityClasses[item.severity ?? "neutral"];
  const display =
    typeof item.value === "number"
      ? item.value.toLocaleString("th-TH")
      : item.value;

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div
          className={cn(
            "h-9 w-9 rounded-lg grid place-items-center flex-shrink-0",
            sev.iconBg,
            sev.iconText,
          )}
          aria-hidden
        >
          {item.icon}
        </div>
        {item.href && (
          <ArrowUpRight
            className="h-4 w-4 text-zinc-400 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
            aria-hidden
          />
        )}
      </div>
      <div className="mt-3">
        <p className="text-xs font-medium text-zinc-500 truncate">
          {item.label}
        </p>
        <p
          className={cn(
            "mt-0.5 text-2xl font-semibold tabular-nums leading-tight",
            sev.valueText,
          )}
        >
          {display}
        </p>
        {item.sub && (
          <p className={cn("mt-1 text-[11px] truncate", sev.subText)}>
            {item.sub}
          </p>
        )}
      </div>
    </>
  );

  const surface = cn(
    "block rounded-2xl bg-white ring-1 ring-zinc-200 shadow-sm p-4 min-h-[112px]",
    item.href &&
      "group transition-all hover:ring-zinc-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
  );

  if (item.href) {
    return (
      <Link href={item.href} className={surface} role="listitem">
        {body}
      </Link>
    );
  }
  return (
    <div className={surface} role="listitem">
      {body}
    </div>
  );
}
