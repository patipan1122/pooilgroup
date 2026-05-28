// ClawFleet Hub — HubHeader
// Sticky workspace header for the morning launcher.
// Layout: greeting + date | branch picker chip | refresh hint
// Sticky: top-14 sm:top-16 z-30 solid bg-white border-b (per tokens.md)
//
// Server Component · branch picker is a real <form> GET that round-trips through
// the page's `?branch=` searchParam. No client JS needed for selection · cookie
// persistence is handled in page.tsx Server Action wrapper.

import Link from "next/link";
import { Sun, Moon, Sunrise, Sunset, RefreshCw, MapPin } from "lucide-react";
import { thaiDateLong, bkkTime } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import { HelpLink } from "@/components/clawfleet/help/help-link";

interface BranchOption {
  id: string;
  name: string;
  code: string;
}

interface HubHeaderProps {
  userName: string;
  /** Branches the user can scope to. If <=1, the picker is hidden */
  branches: BranchOption[];
  /** Selected branchId · "" = all branches */
  selectedBranchId: string;
  /** Pathname to post back to · used to keep URL consistent (default /clawfleet/hub) */
  formAction?: string;
  /** Optional override now() for testing */
  now?: Date;
}

function greetingFor(hour: number): {
  text: string;
  Icon: typeof Sun;
} {
  if (hour < 5) return { text: "ราตรีสวัสดิ์คุณ", Icon: Moon };
  if (hour < 11) return { text: "อรุณสวัสดิ์คุณ", Icon: Sunrise };
  if (hour < 16) return { text: "สวัสดีตอนบ่ายคุณ", Icon: Sun };
  if (hour < 19) return { text: "สวัสดีตอนเย็นคุณ", Icon: Sunset };
  return { text: "สวัสดีตอนค่ำคุณ", Icon: Moon };
}

export function HubHeader({
  userName,
  branches,
  selectedBranchId,
  formAction = "/clawfleet/hub",
  now,
}: HubHeaderProps) {
  const dt = now ?? new Date();
  const bkkHour = parseInt(
    new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hour12: false,
      timeZone: "Asia/Bangkok",
    }).format(dt),
    10,
  );
  const { text, Icon } = greetingFor(bkkHour);
  const dateLabel = thaiDateLong(dt);
  const timeLabel = bkkTime(dt);
  const showPicker = branches.length > 1;

  const selectedBranch =
    selectedBranchId === ""
      ? null
      : branches.find((b) => b.id === selectedBranchId);

  return (
    <header
      className={cn(
        "sticky top-14 sm:top-16 z-30 bg-white border-b border-zinc-200",
        "px-4 sm:px-6 lg:px-8 py-4",
        "mx-[-1rem] sm:mx-[-1.5rem] lg:mx-[-2rem] mb-6",
      )}
    >
      <div className="mx-auto max-w-7xl flex items-start sm:items-center justify-between gap-3 flex-col sm:flex-row">
        {/* Left — greeting + date */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-zinc-500 mb-1">
            <Icon className="h-4 w-4" aria-hidden />
            <span className="text-sm">
              {dateLabel} · {timeLabel} น.
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-zinc-900 leading-tight truncate">
            {text}{" "}
            <span className="text-[var(--color-brand-700)]">{userName}</span>
          </h1>
        </div>

        {/* Right — branch picker + refresh */}
        <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
          {showPicker && (
            <form
              action={formAction}
              method="get"
              className="flex items-center gap-2"
            >
              <label
                htmlFor="hub-branch-picker"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500"
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                สาขา
              </label>
              <select
                id="hub-branch-picker"
                name="branch"
                defaultValue={selectedBranchId}
                aria-label="เลือกสาขา"
                className={cn(
                  "min-h-[40px] rounded-full px-3 pr-8 text-sm font-medium",
                  "bg-white border border-zinc-300 text-zinc-900",
                  "hover:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500",
                  "tabular-nums",
                )}
              >
                <option value="">ทุกสาขา ({branches.length})</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className={cn(
                  "min-h-[40px] px-3 rounded-full text-sm font-semibold",
                  "bg-zinc-900 text-white hover:bg-zinc-800",
                  "focus:outline-none focus:ring-2 focus:ring-blue-500",
                )}
              >
                ใช้
              </button>
            </form>
          )}

          {!showPicker && branches.length === 1 && (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-full text-sm font-medium",
                "bg-zinc-100 text-zinc-700",
              )}
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              {branches[0].name}
            </span>
          )}

          {selectedBranch && showPicker && (
            <span className="hidden lg:inline-flex items-center gap-1 text-[11px] text-zinc-500">
              กรอง: {selectedBranch.code}
            </span>
          )}

          <HelpLink variant="icon" />

          <Link
            href={formAction}
            prefetch={false}
            className={cn(
              "inline-flex items-center justify-center h-10 w-10 rounded-full",
              "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100",
              "focus:outline-none focus:ring-2 focus:ring-blue-500",
            )}
            aria-label="รีเฟรชข้อมูล"
            title="กดเพื่อโหลดตัวเลขล่าสุด"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </header>
  );
}
