// Big mobile-readable KPI tile · color-coded by tone
import { cn } from "@/lib/utils/cn";
import type { ReactNode } from "react";

type Tone = "red" | "orange" | "yellow" | "green" | "blue" | "gray";

const TONE_BG: Record<Tone, string> = {
  red: "bg-danger/10 border-danger/30",
  orange: "bg-orange-500/10 border-orange-500/30",
  yellow: "bg-warning/10 border-warning/30",
  green: "bg-success/10 border-success/30",
  blue: "bg-blue-500/10 border-blue-500/30",
  gray: "bg-muted border-border",
};

const TONE_FG: Record<Tone, string> = {
  red: "text-[hsl(0,84%,40%)]",
  orange: "text-orange-700",
  yellow: "text-[hsl(38,92%,32%)]",
  green: "text-[hsl(142,76%,28%)]",
  blue: "text-blue-700",
  gray: "text-foreground",
};

export function KpiTile({
  label,
  value,
  hint,
  tone = "gray",
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: Tone;
  icon?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-xl border p-4 shadow-sm sm:p-5",
        TONE_BG[tone]
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground sm:text-sm">
          {label}
        </span>
        {icon ? <span className={cn("opacity-70", TONE_FG[tone])}>{icon}</span> : null}
      </div>
      <div className={cn("text-2xl font-bold tabular-nums sm:text-3xl", TONE_FG[tone])}>
        {value}
      </div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
