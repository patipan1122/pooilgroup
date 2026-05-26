// ClawFleet Hub — QuickActionsBar
// 4 quick deep-links rendered as buttons. Responsive 2x2 on mobile · 4x1 desktop.
// Server component · uses next/link wrapped buttons (no JS for nav).

import Link from "next/link";
import {
  PlayCircle,
  AlertTriangle,
  FileBarChart2,
  Settings2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface QuickActionsBarProps {
  /** If true, shows the "ตั้งค่าระบบ" entry (admin tier only) */
  showSettings: boolean;
}

interface QuickItem {
  href: string;
  Icon: LucideIcon;
  label: string;
  iconClass: string;
}

const ITEMS: QuickItem[] = [
  {
    href: "/clawfleet/operations?action=new-session",
    Icon: PlayCircle,
    label: "เริ่มรอบเก็บใหม่",
    iconClass: "text-blue-600",
  },
  {
    href: "/clawfleet/operations?tab=anomaly",
    Icon: AlertTriangle,
    label: "ดู anomaly ทั้งหมด",
    iconClass: "text-rose-600",
  },
  {
    href: "/clawfleet/insights?view=events&period=yesterday",
    Icon: FileBarChart2,
    label: "ดูรีพอตเมื่อวาน",
    iconClass: "text-indigo-600",
  },
  {
    href: "/clawfleet/setup",
    Icon: Settings2,
    label: "ตั้งค่าระบบ",
    iconClass: "text-zinc-600",
  },
];

export function QuickActionsBar({ showSettings }: QuickActionsBarProps) {
  const items = showSettings ? ITEMS : ITEMS.slice(0, 3);
  return (
    <div
      className={cn(
        "grid gap-3",
        showSettings
          ? "grid-cols-2 sm:grid-cols-4"
          : "grid-cols-1 sm:grid-cols-3",
      )}
    >
      {items.map(({ href, Icon, label, iconClass }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "group inline-flex items-center justify-start gap-3",
            "min-h-[56px] px-4 py-3 rounded-xl",
            "bg-white border border-zinc-200 hover:border-zinc-300",
            "hover:bg-zinc-50 transition-colors shadow-sm",
          )}
        >
          <Icon
            className={cn(
              "h-5 w-5 flex-shrink-0 transition-transform group-hover:scale-110",
              iconClass,
            )}
          />
          <span className="text-sm font-semibold text-zinc-900 truncate">
            {label}
          </span>
        </Link>
      ))}
    </div>
  );
}
