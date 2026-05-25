// MakerCheckerBadge · shows maker / checker / approver roles inline.
// Spec: AUDIT_chairops_2026-05-25 §6.maker_checker tokens.
//
// Used in write-offs (BR15 atomic chain) + reconcile detail to show audit
// trail. Each role slot can be pending (empty avatar + label "รอ") or filled
// (name initials + name).
//
// SERVER-FRIENDLY · pure presentational.

import { cn } from "@/lib/utils/cn";
import { Check, Crown, HardHat } from "lucide-react";
import type { ReactNode } from "react";

export interface MakerCheckerActor {
  /** Display name e.g. "สมหญิง · OFFICE" */
  name: string;
  /** When set, shows the timestamp e.g. "12 พ.ค. · 14:32". */
  at?: string;
}

export interface MakerCheckerBadgeProps {
  maker?: MakerCheckerActor | null;
  checker?: MakerCheckerActor | null;
  approver?: MakerCheckerActor | null;
  /** Hide approver slot (when not required by the action — BR15 sets this). */
  noApprover?: boolean;
  /** Compact = single-line, hide timestamps. */
  compact?: boolean;
  className?: string;
}

type Slot = {
  key: "maker" | "checker" | "approver";
  label: string;
  icon: ReactNode;
  actor?: MakerCheckerActor | null;
  toneFilled: string;
  toneEmpty: string;
};

export function MakerCheckerBadge({
  maker,
  checker,
  approver,
  noApprover = false,
  compact = false,
  className,
}: MakerCheckerBadgeProps) {
  const slots: Slot[] = [
    {
      key: "maker",
      label: "ผู้สร้าง",
      icon: <HardHat className="size-3.5" aria-hidden="true" />,
      actor: maker,
      toneFilled: "bg-blue-50 text-blue-800 ring-blue-200",
      toneEmpty: "bg-zinc-50 text-zinc-500 ring-zinc-200",
    },
    {
      key: "checker",
      label: "ผู้ตรวจ",
      icon: <Check className="size-3.5" aria-hidden="true" />,
      actor: checker,
      toneFilled: "bg-emerald-50 text-emerald-800 ring-emerald-200",
      toneEmpty: "bg-zinc-50 text-zinc-500 ring-zinc-200",
    },
    ...(noApprover
      ? []
      : [
          {
            key: "approver" as const,
            label: "ผู้อนุมัติ",
            icon: <Crown className="size-3.5" aria-hidden="true" />,
            actor: approver,
            toneFilled: "bg-violet-50 text-violet-800 ring-violet-200",
            toneEmpty: "bg-zinc-50 text-zinc-500 ring-zinc-200",
          },
        ]),
  ];

  return (
    <ol
      className={cn(
        "flex items-center gap-1.5",
        compact ? "flex-wrap" : "flex-wrap",
        className,
      )}
      aria-label="ขั้นตอนผู้สร้าง-ตรวจ-อนุมัติ"
    >
      {slots.map((slot, idx) => {
        const filled = !!slot.actor;
        return (
          <li key={slot.key} className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1",
                filled ? slot.toneFilled : slot.toneEmpty,
              )}
            >
              {slot.icon}
              <span className="font-semibold">{slot.label}</span>
              <span className="text-zinc-400">·</span>
              {filled ? (
                <span>
                  {slot.actor!.name}
                  {!compact && slot.actor!.at && (
                    <span className="ml-1 text-[10px] font-normal text-zinc-500">
                      {slot.actor!.at}
                    </span>
                  )}
                </span>
              ) : (
                <span className="italic">รอ</span>
              )}
            </span>
            {idx < slots.length - 1 && (
              <span className="text-xs text-zinc-300" aria-hidden="true">
                →
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
