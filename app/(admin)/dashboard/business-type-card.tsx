// BusinessTypeCard — used by Executive Dashboard
// ─────────────────────────────────────────────────────────────
// Memory rules:
//   - Popup-first drilldown (feedback_popup_first_drilldown.md)
//     กดทั้งการ์ด → navigate ไป detail (เพราะ entity = ประเภทธุรกิจ)
//   - Brand DNA: blue / underline / floating / dot grid
//   - Typography ปกติ — number ≤ sm:text-3xl
//
// Props รับ aggregated bucket จาก lib/cashhub/aggregator.ts (ห้าม mock)
// ─────────────────────────────────────────────────────────────

"use client";

import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronRight,
  Building2,
} from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { ProgressBar } from "@/components/cashhub/charts";
import { formatBahtCompact } from "@/lib/utils/format";
import { BUSINESS_TYPES } from "@/constants/business-types";

export interface BusinessTypeBucket {
  type: string;
  branchCount: number;
  total: number;
  targetTotal: number;
  submittedToday: number;
  pendingToday: number;
  missingToday: number;
}

interface Props {
  bucket: BusinessTypeBucket;
  /** % ของเดือนที่ผ่านไป (0–100) — ใช้เป็น marker บน progress bar */
  monthPaceMarker: number;
}

export function BusinessTypeCard({ bucket, monthPaceMarker }: Props) {
  const cfg = BUSINESS_TYPES[bucket.type];
  const label = cfg?.label ?? bucket.type;
  const emoji = cfg?.emoji ?? "📦";

  const targetPct =
    bucket.targetTotal > 0
      ? Math.min(100, (bucket.total / bucket.targetTotal) * 100)
      : 0;

  // Status pill — pick worst signal first (red > amber > green)
  const statusPill = (() => {
    if (bucket.missingToday > 0) {
      return {
        emoji: "🔴",
        label: `ขาด ${bucket.missingToday}`,
        cls: "bg-red-50 text-red-700 border-red-200",
      };
    }
    if (bucket.pendingToday > 0) {
      return {
        emoji: "⏳",
        label: `รอ ${bucket.pendingToday}`,
        cls: "bg-amber-50 text-amber-700 border-amber-200",
      };
    }
    return {
      emoji: "✅",
      label: "ครบ",
      cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  })();

  // Drilldown → /cashhub/dashboard with type filter (entity navigation)
  const href = `/cashhub/dashboard/business/${bucket.type}`;

  return (
    <Link href={href} className="block group">
      <Card className="h-full transition-all group-hover:border-[var(--color-brand-300)] group-hover:shadow-blue/40">
        <CardBody className="p-4 sm:p-5">
          {/* Header: emoji + label + chevron */}
          <div className="flex items-start gap-3 mb-3">
            <div className="size-11 shrink-0 rounded-2xl bg-[var(--color-brand-50)] border-2 border-[var(--color-brand-100)] flex items-center justify-center text-2xl">
              {emoji}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-zinc-900 truncate">{label}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5 inline-flex items-center gap-1">
                <Building2 className="size-3" />
                {bucket.branchCount} สาขา
              </div>
            </div>
            <ChevronRight className="size-5 text-zinc-300 group-hover:text-[var(--color-brand-500)] transition-colors shrink-0" />
          </div>

          {/* Money line — capped at sm:text-3xl per memory rule */}
          <div className="text-2xl sm:text-3xl font-extrabold tabular-num font-display text-zinc-900">
            {formatBahtCompact(bucket.total)}
          </div>

          {/* Target progress (only if target set) */}
          {bucket.targetTotal > 0 ? (
            <div className="mt-2">
              <ProgressBar
                value={targetPct}
                marker={monthPaceMarker}
                className="h-2"
              />
              <div className="flex justify-between mt-1 text-[10px] text-zinc-500 tabular-num">
                <span>{targetPct.toFixed(0)}% ของเป้า</span>
                <span>เป้า {formatBahtCompact(bucket.targetTotal)}</span>
              </div>
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-zinc-400">
              ยังไม่ได้ตั้งเป้า
            </div>
          )}

          {/* Status row — daily compliance */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold ${statusPill.cls}`}
            >
              <span>{statusPill.emoji}</span>
              {statusPill.label}
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 font-semibold">
              <CheckCircle2 className="size-3" />
              ส่ง {bucket.submittedToday}
            </span>
            {bucket.pendingToday > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 font-semibold">
                <Clock className="size-3" />
                รอ {bucket.pendingToday}
              </span>
            )}
            {bucket.missingToday > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] text-red-700 font-semibold">
                <AlertCircle className="size-3" />
                ขาด {bucket.missingToday}
              </span>
            )}
          </div>
        </CardBody>
      </Card>
    </Link>
  );
}
