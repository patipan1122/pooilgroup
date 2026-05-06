"use client";

import { CheckCircle2, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import type { ReconcileResult } from "@/lib/cashhub/reconcile";
import { formatBaht } from "@/lib/utils/format";

interface Props {
  result: ReconcileResult;
  totalSales: number;
}

export function ReconcileIndicator({ result, totalSales }: Props) {
  if (totalSales === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-zinc-200 px-4 py-3 text-center">
        <p className="text-sm text-zinc-400">กรอกยอดขายเพื่อตรวจสอบ</p>
      </div>
    );
  }

  const tone =
    result.status === "balanced"
      ? "balanced"
      : result.status === "over"
        ? "over"
        : "under";

  const palette = {
    balanced: {
      box: "bg-green-50 border-green-300",
      label: "text-green-700",
      icon: <CheckCircle2 className="size-4" />,
    },
    over: {
      box: "bg-[var(--color-brand-50)] border-[var(--color-brand-200)]",
      label: "text-[var(--color-brand-700)]",
      icon: <Info className="size-4" />,
    },
    under: {
      box: "bg-red-50 border-red-300",
      label: "text-red-700",
      icon: <AlertCircle className="size-4" />,
    },
  }[tone];

  return (
    <div
      className={cn(
        "rounded-2xl px-4 py-3.5 border-2 transition-all",
        palette.box,
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-zinc-600">รวมรับ</span>
        <span
          className={cn(
            "text-lg font-semibold tabular-num",
            palette.label,
          )}
        >
          {formatBaht(result.totalReceived)}
        </span>
      </div>
      <div
        className={cn(
          "flex items-center gap-1.5 text-sm font-medium",
          palette.label,
        )}
      >
        {palette.icon}
        {result.message}
      </div>
    </div>
  );
}
