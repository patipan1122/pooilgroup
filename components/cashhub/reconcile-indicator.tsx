"use client";

import { CheckCircle2, AlertCircle } from "lucide-react";
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

  return (
    <div
      className={cn(
        "rounded-2xl px-4 py-3.5 border-2 transition-all",
        result.isBalanced
          ? "bg-green-50 border-green-300"
          : "bg-red-50 border-red-300",
      )}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-zinc-600">รวมรับ</span>
        <span
          className={cn(
            "text-lg font-semibold tabular-num",
            result.isBalanced ? "text-green-700" : "text-red-700",
          )}
        >
          {formatBaht(result.totalReceived)}
        </span>
      </div>
      <div
        className={cn(
          "flex items-center gap-1.5 text-sm font-medium",
          result.isBalanced ? "text-green-700" : "text-red-700",
        )}
      >
        {result.isBalanced ? (
          <CheckCircle2 className="size-4" />
        ) : (
          <AlertCircle className="size-4" />
        )}
        {result.message}
      </div>
    </div>
  );
}
