"use client";
// Insights · 7-tab view toggle bar
// Maps to ?view= URL param · preserves all other params
// Mobile: horizontal scroll · desktop: inline row
// Icons: Lucide only (per QC-D1 · tokens.md §Icons)

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import {
  BarChart3,
  ListChecks,
  Gamepad2,
  Building2,
  Users,
  Package,
  FileSearch,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

export type InsightsView =
  | "events"
  | "sessions"
  | "machines"
  | "branches"
  | "staff"
  | "stock"
  | "audit";

interface ViewToggleProps {
  active: InsightsView;
  counts?: Partial<Record<InsightsView, number>>;
}

const TABS: Array<{
  key: InsightsView;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: "events", label: "เหตุการณ์", icon: BarChart3 },
  { key: "sessions", label: "รอบเก็บ", icon: ListChecks },
  { key: "machines", label: "ตู้", icon: Gamepad2 },
  { key: "branches", label: "สาขา", icon: Building2 },
  { key: "staff", label: "พนักงาน", icon: Users },
  { key: "stock", label: "สต๊อก", icon: Package },
  { key: "audit", label: "Audit log", icon: FileSearch },
];

export function InsightsViewToggle({ active, counts }: ViewToggleProps) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  function go(view: InsightsView) {
    const next = new URLSearchParams(sp.toString());
    next.set("view", view);
    // clear drill when switching view (different entity types)
    next.delete("drill");
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  }

  return (
    <div
      role="tablist"
      aria-label="มุมมอง Insights"
      className="-mx-4 flex gap-1 overflow-x-auto px-4 py-2 sm:mx-0 sm:flex-wrap sm:px-0"
    >
      {TABS.map((t) => {
        const Icon = t.icon;
        const isActive = t.key === active;
        const count = counts?.[t.key];
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            disabled={pending}
            onClick={() => go(t.key)}
            className={cn(
              "inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-3 py-2 text-xs font-bold transition-colors min-h-[40px]",
              isActive
                ? "border-zinc-900 bg-zinc-900 text-white"
                : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400",
              pending && "opacity-60",
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{t.label}</span>
            {typeof count === "number" && (
              <span
                className={cn(
                  "tabular-nums",
                  isActive ? "opacity-80" : "text-zinc-500",
                )}
              >
                ({count.toLocaleString("th-TH")})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
