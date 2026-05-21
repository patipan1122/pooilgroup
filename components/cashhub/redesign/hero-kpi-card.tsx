// HeroKpiCard — single tile in the Dashboard V1 hero strip.
// Variants: total / progress / anomalies / action.
//
// Keep prop surface tiny — caller composes value display so cards stay flexible.

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
      <div
        className="text-[10.5px] font-semibold text-[var(--ch-text-3)]"
        style={{ letterSpacing: "0.1em", textTransform: "uppercase" }}
      >
        {eyebrow}
      </div>
      {children}
    </div>
  );
}
