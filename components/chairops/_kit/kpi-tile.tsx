// KpiTile (ChairOps variant) · centered value tile for exec home.
// Spec: AUDIT_chairops_2026-05-25 §7.1 — 5 KPI tiles on exec home.
//
// DIFFERS from Pool's `<KpiTile>` (horizontal compact strip):
//   - Number is CENTERED + extra-large (text-3xl) for "see across the room"
//   - Label sits on top (small caps-equivalent — Thai is NOT uppercased)
//   - Delta line at bottom with up/down arrow + tone
//   - Clickable wrapper (entire tile is an action target)
//
// SERVER-FRIENDLY · no client hooks unless `onClick` is used (renderer decides).

import { cn } from "@/lib/utils/cn";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";

export type KpiTone = "neutral" | "success" | "warning" | "danger" | "info";
export type DeltaDirection = "up" | "down" | "flat";

const toneClasses: Record<
  KpiTone,
  { ring: string; valueText: string; iconBg: string; iconText: string }
> = {
  neutral: {
    ring: "ring-zinc-200",
    valueText: "text-zinc-900",
    iconBg: "bg-zinc-100",
    iconText: "text-zinc-700",
  },
  success: {
    ring: "ring-emerald-200",
    valueText: "text-emerald-700",
    iconBg: "bg-emerald-100",
    iconText: "text-emerald-700",
  },
  warning: {
    ring: "ring-amber-200",
    valueText: "text-amber-700",
    iconBg: "bg-amber-100",
    iconText: "text-amber-700",
  },
  danger: {
    ring: "ring-rose-300",
    valueText: "text-rose-700",
    iconBg: "bg-rose-100",
    iconText: "text-rose-700",
  },
  info: {
    ring: "ring-blue-200",
    valueText: "text-blue-700",
    iconBg: "bg-blue-100",
    iconText: "text-blue-700",
  },
};

const deltaIcon = {
  up: ArrowUpRight,
  down: ArrowDownRight,
  flat: Minus,
};

export interface ChairopsKpiTileProps {
  label: string;
  value: number | string;
  unit?: string;
  /** "ดีขึ้น 12%" — short context line beneath value. */
  delta?: string;
  deltaDirection?: DeltaDirection;
  /** Tone applies to ring + value color + icon. */
  tone?: KpiTone;
  icon?: ReactNode;
  /** Optional click handler — turns tile into a clickable card. */
  href?: string;
  className?: string;
}

export function ChairopsKpiTile({
  label,
  value,
  unit,
  delta,
  deltaDirection = "flat",
  tone = "neutral",
  icon,
  href,
  className,
}: ChairopsKpiTileProps) {
  const t = toneClasses[tone];
  const DeltaIcon = deltaIcon[deltaDirection];
  const deltaColor =
    deltaDirection === "up"
      ? "text-emerald-700"
      : deltaDirection === "down"
        ? "text-rose-700"
        : "text-zinc-500";

  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-zinc-500">{label}</p>
        {icon && (
          <span
            className={cn(
              "grid size-8 place-items-center rounded-lg",
              t.iconBg,
              t.iconText,
            )}
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
      </div>
      <p
        className={cn(
          "text-center text-3xl font-extrabold tabular-nums sm:text-4xl",
          t.valueText,
        )}
      >
        {typeof value === "number" ? value.toLocaleString("th-TH") : value}
        {unit && (
          <span className="ml-1 text-sm font-medium text-zinc-500">
            {unit}
          </span>
        )}
      </p>
      {delta && (
        <p
          className={cn(
            "flex items-center justify-center gap-1 text-xs font-medium",
            deltaColor,
          )}
        >
          <DeltaIcon className="size-3.5" aria-hidden="true" />
          <span>{delta}</span>
        </p>
      )}
    </>
  );

  const containerClass = cn(
    "flex min-h-[120px] flex-col justify-between gap-2 rounded-2xl bg-background p-4 ring-1 transition-all",
    t.ring,
    href && "cursor-pointer hover:scale-[1.01] hover:shadow-md active:scale-100",
    className,
  );

  if (href) {
    return (
      <a href={href} className={containerClass}>
        {inner}
      </a>
    );
  }
  return <div className={containerClass}>{inner}</div>;
}
