// HeroKpiCard — single tile in the Dashboard V1 hero strip.
// Variants: total / progress / anomalies / action.
//
// Keep prop surface tiny — caller composes value display so cards stay flexible.
//
// Audit รอบ 60: removed forced uppercase/letter-spacing on eyebrow (Thai script
// doesn't honor `uppercase` and looks awful with letter-spacing > 0.05em — see
// [[section-component-eyebrow-rootcause]]). Every consumer of this card passed
// Thai labels ("ยอดขายรวม", "สาขาที่กรอกครบ", "น่าเป็นห่วง", "รออนุมัติ"), so the
// transform produced no visual effect on Thai but did add awkward kerning.

import type { ReactNode } from "react";

interface Props {
  eyebrow: string;
  children: ReactNode;
  className?: string;
}

export function HeroKpiCard({ eyebrow, children, className }: Props) {
  return (
    <div
      className={`ch-card-v2 px-4 py-4 sm:px-5 sm:py-4 flex flex-col gap-1 ${className ?? ""}`}
    >
      <div className="text-[11px] font-semibold text-[var(--ch-text-3)]">
        {eyebrow}
      </div>
      {children}
    </div>
  );
}
