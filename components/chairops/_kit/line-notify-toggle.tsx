"use client";

// LineNotifyToggle · per-event channel toggle row.
// Spec: AUDIT_chairops_2026-05-25 §6 + UX Phase 2 LineNotifyMatrix
//       (Wave-1 inline variant — full matrix deferred to Wave 2).
//
// Each row shows: event label · channel name · on/off switch · last-sent count.
// Used in settings/channels page + alert config sidebar. The actual notify
// dispatch lives elsewhere — this is the UI control only.

import { cn } from "@/lib/utils/cn";
import { BellOff, BellRing, MessageCircle } from "lucide-react";

export interface LineNotifyToggleProps {
  /** Event label e.g. "เงินขาดสาขา · BR2" */
  eventLabel: string;
  /** Channel label e.g. "LINE · ห้องบัญชี" */
  channelLabel: string;
  enabled: boolean;
  /** Number of sends in the past 30 days. */
  sendCount?: number;
  /** Disabled (e.g. channel disconnected) — show muted + lock. */
  disabled?: boolean;
  /** Reason for disabled state e.g. "ยังไม่ได้เชื่อมช่อง". */
  disabledReason?: string;
  onChange?: (enabled: boolean) => void;
  className?: string;
}

export function LineNotifyToggle({
  eventLabel,
  channelLabel,
  enabled,
  sendCount = 0,
  disabled = false,
  disabledReason,
  onChange,
  className,
}: LineNotifyToggleProps) {
  const handleClick = () => {
    if (disabled) return;
    onChange?.(!enabled);
  };

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-border bg-background p-3",
        disabled && "opacity-60",
        className,
      )}
    >
      <span
        className={cn(
          "grid size-10 place-items-center rounded-lg",
          enabled && !disabled
            ? "bg-emerald-100 text-emerald-700"
            : "bg-zinc-100 text-zinc-500",
        )}
        aria-hidden="true"
      >
        {enabled && !disabled ? (
          <BellRing className="size-5" />
        ) : (
          <BellOff className="size-5" />
        )}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-zinc-900">
          {eventLabel}
        </p>
        <p className="flex items-center gap-1 truncate text-xs text-zinc-600">
          <MessageCircle className="size-3" aria-hidden="true" />
          <span>{channelLabel}</span>
          {!disabled && sendCount > 0 && (
            <>
              <span className="text-zinc-400">·</span>
              <span className="tabular-nums">
                ส่งแล้ว {sendCount.toLocaleString("th-TH")} ครั้ง (30 วัน)
              </span>
            </>
          )}
          {disabled && disabledReason && (
            <>
              <span className="text-zinc-400">·</span>
              <span className="italic text-rose-600">{disabledReason}</span>
            </>
          )}
        </p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={`เปิด/ปิดการแจ้งเตือน ${eventLabel}`}
        disabled={disabled}
        onClick={handleClick}
        className={cn(
          "relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full ring-1 transition-colors",
          "min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0", // 44px touch on mobile
          enabled && !disabled
            ? "bg-emerald-600 ring-emerald-700"
            : "bg-zinc-200 ring-zinc-300",
          disabled && "cursor-not-allowed",
          !disabled && "hover:opacity-90 active:scale-95",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "inline-block size-5 transform rounded-full bg-white shadow transition-transform",
            enabled ? "translate-x-6" : "translate-x-1",
          )}
        />
      </button>
    </div>
  );
}
