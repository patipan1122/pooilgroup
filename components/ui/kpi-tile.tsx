// Compact KPI tile — horizontal icon + label + value layout
// Extracted from local copies in `components/recruit/applications-inbox.tsx`
// and `components/repair/admin-inbox.tsx` (Polish Team รอบ 45 Agent C insight).
//
// Use `<StatBlock>` for executive-size cards (md/lg/xl).
// Use `<KpiTile>` for compact dashboard strips (≤5 columns).
//
// Reference: artifact #1 "where does the eye go first?" — the icon box steers
// the eye, the value commands attention, the helper is supportive only.

import { cn } from "@/lib/utils/cn";
import type { ReactNode } from "react";

type Accent =
  | "zinc"
  | "brand"
  | "danger"
  | "warning"
  | "orange"
  | "success"
  | "info";

const accentClasses: Record<
  Accent,
  { iconBg: string; iconText: string; valueText: string }
> = {
  zinc: {
    iconBg: "bg-zinc-100",
    iconText: "text-zinc-700",
    valueText: "text-zinc-900",
  },
  brand: {
    iconBg: "bg-[var(--color-brand-100)]",
    iconText: "text-[var(--color-brand-700)]",
    valueText: "text-[var(--color-brand-800)]",
  },
  danger: {
    iconBg: "bg-red-100",
    iconText: "text-red-700",
    valueText: "text-red-700",
  },
  warning: {
    iconBg: "bg-amber-100",
    iconText: "text-amber-700",
    valueText: "text-amber-700",
  },
  orange: {
    iconBg: "bg-orange-100",
    iconText: "text-orange-700",
    valueText: "text-orange-700",
  },
  success: {
    iconBg: "bg-emerald-100",
    iconText: "text-emerald-700",
    valueText: "text-emerald-800",
  },
  info: {
    iconBg: "bg-blue-100",
    iconText: "text-blue-700",
    valueText: "text-blue-800",
  },
};

export interface KpiTileProps {
  icon?: ReactNode;
  label: string;
  value: number | string;
  unit?: string;
  accent?: Accent;
  sub?: string;
  subDanger?: boolean;
  /** When true, value font is smaller (good for currency rolls-ups) */
  isMoney?: boolean;
  className?: string;
}

export function KpiTile({
  icon,
  label,
  value,
  unit,
  accent = "zinc",
  sub,
  subDanger,
  isMoney,
  className,
}: KpiTileProps) {
  const a = accentClasses[accent];
  return (
    <div
      className={cn(
        "bg-white rounded-xl border border-zinc-200 p-3 flex items-start gap-3",
        className,
      )}
    >
      {icon && (
        <div
          className={cn(
            "size-8 rounded-lg grid place-items-center flex-shrink-0",
            a.iconBg,
            a.iconText,
          )}
        >
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-zinc-500 truncate">{label}</p>
        <p
          className={cn(
            "font-extrabold tabular-num",
            isMoney ? "text-base sm:text-lg" : "text-xl sm:text-2xl",
            a.valueText,
          )}
        >
          {typeof value === "number" ? value.toLocaleString("th-TH") : value}
          {unit && (
            <span className="text-xs text-zinc-500 font-medium ml-1">
              {unit}
            </span>
          )}
        </p>
        {sub && (
          <p
            className={cn(
              "mt-1 text-xs font-bold",
              subDanger ? "text-red-700" : "text-zinc-500",
            )}
          >
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}
