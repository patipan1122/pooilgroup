import { cn } from "@/lib/utils/cn";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { ReactNode } from "react";

interface StatBlockProps {
  label: string;
  value: string | number;
  unit?: string;
  helper?: string;
  trend?: { value: number; label?: string };
  icon?: ReactNode;
  className?: string;
  size?: "md" | "lg" | "xl";
}

const sizeClasses = {
  md: { value: "text-2xl", helper: "text-xs" },
  lg: { value: "text-3xl", helper: "text-sm" },
  xl: { value: "text-4xl sm:text-5xl", helper: "text-sm" },
};

export function StatBlock({
  label,
  value,
  unit,
  helper,
  trend,
  icon,
  className,
  size = "md",
}: StatBlockProps) {
  const trendIcon = trend
    ? trend.value > 0
      ? TrendingUp
      : trend.value < 0
        ? TrendingDown
        : Minus
    : null;
  const TrendIcon = trendIcon;

  return (
    <div
      className={cn(
        "rounded-2xl border-2 border-zinc-200 bg-white p-4 sm:p-5",
        "hover:border-[var(--color-brand-300)] transition-colors",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-xs uppercase tracking-widest text-zinc-500 font-semibold truncate">
          {label}
        </p>
        {icon && <div className="text-[var(--color-brand-600)] shrink-0">{icon}</div>}
      </div>
      <div
        className={cn(
          "font-extrabold tabular-num font-display tracking-tight text-zinc-900",
          sizeClasses[size].value,
        )}
      >
        {value}
        {unit && (
          <span className="text-base font-medium text-zinc-500 ml-1">
            {unit}
          </span>
        )}
      </div>
      {(helper || trend) && (
        <div
          className={cn(
            "flex items-center gap-1.5 mt-1.5",
            sizeClasses[size].helper,
          )}
        >
          {TrendIcon && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold tabular-num",
                trend!.value > 0 && "bg-green-50 text-green-700",
                trend!.value < 0 && "bg-red-50 text-red-700",
                trend!.value === 0 && "bg-zinc-50 text-zinc-700",
              )}
            >
              <TrendIcon className="size-3" />
              {trend!.value > 0 ? "+" : ""}
              {trend!.value}%
            </span>
          )}
          {helper && <span className="text-zinc-500 truncate">{helper}</span>}
        </div>
      )}
    </div>
  );
}
