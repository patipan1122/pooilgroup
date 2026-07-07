"use client";

import Link from "next/link";
import { useState, useTransition, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  STATUS_LABELS,
  STATUS_TONE,
  APPLICATION_STATUSES,
  TAG_COLOR_CHIP,
  parseTag,
  type ApplicationStatus,
} from "@/lib/recruit/types";
import { Badge } from "@/components/ui/badge";
import { changeApplicationStatus } from "@/lib/recruit/actions";
import { ChevronDown } from "lucide-react";

interface AppCard {
  id: string;
  applicantName: string;
  phone: string;
  posting: string;
  aiScore: number | null;
  starRating: number | null;
  flagged: boolean;
  refId: string;
  tags?: string[];
  updatedAt?: string | null;
}

// Per-stage SLA in days — overdue indicator triggers when status hasn't
// moved within this window (canvas Section 05A red border + 🔥 flag).
const STAGE_SLA_DAYS: Partial<Record<ApplicationStatus, number>> = {
  NEW: 3,
  SCREENING: 5,
  INTERVIEW: 7,
  OFFERED: 5,
};

function isOverdue(status: ApplicationStatus, updatedAt: string | null | undefined): boolean {
  if (!updatedAt) return false;
  const sla = STAGE_SLA_DAYS[status];
  if (!sla) return false;
  const days = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  return days > sla;
}

interface Props {
  status: ApplicationStatus;
  applications: AppCard[];
  canWrite: boolean;
  /** Build URL for clicking a card (used by pipeline page to open slide-in detail) */
  selectHref?: (id: string) => string;
  /** Multi-select (Wave 3): ids currently checked + toggle callback. Absent = no checkboxes. */
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
}

export function PipelineColumn({
  status,
  applications,
  canWrite,
  selectHref,
  selectedIds,
  onToggleSelect,
}: Props) {
  return (
    <div className="w-[82vw] max-w-[300px] snap-start sm:w-auto sm:max-w-none shrink-0 sm:shrink rounded-2xl border border-zinc-200 bg-zinc-50/40 overflow-hidden flex flex-col max-h-[80vh]">
      <div className="p-3 border-b border-zinc-200 bg-white">
        <div className="flex items-center justify-between">
          <Badge tone={STATUS_TONE[status]}>
            <span className="size-1.5 rounded-full bg-current opacity-60" />
            {STATUS_LABELS[status]}
          </Badge>
          <span className="text-xs font-bold tabular-num text-zinc-500">
            {applications.length}
          </span>
        </div>
      </div>
      <div className="overflow-y-auto p-2 space-y-2 flex-1">
        {applications.length === 0 ? (
          <div className="text-center text-xs text-zinc-500 py-8 italic">
            ยังไม่มีใบสมัครในสถานะนี้
          </div>
        ) : (
          applications.map((a) => (
            <ApplicationCard
              key={a.id}
              app={a}
              currentStatus={status}
              canWrite={canWrite}
              cardHref={selectHref ? selectHref(a.id) : `/recruit/applications/${a.id}`}
              selected={selectedIds?.has(a.id) ?? false}
              onToggleSelect={onToggleSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}

function ApplicationCard({
  app,
  currentStatus,
  canWrite,
  cardHref,
  selected,
  onToggleSelect,
}: {
  app: AppCard;
  currentStatus: ApplicationStatus;
  canWrite: boolean;
  cardHref: string;
  selected: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [, startTransition] = useTransition();
  // "ย้ายสถานะ" menu is rendered as a FIXED popover anchored to the button so it
  // escapes the column's overflow-hidden + the card-list's scroll clipping
  // (เดิม absolute → การ์ดล่างสุดเมนูโดนตัด). Flips up when near the viewport bottom.
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number; width: number } | null>(null);

  function closeMenu() {
    setShowMenu(false);
    setMenuPos(null);
  }

  function toggleMenu() {
    if (showMenu) return closeMenu();
    const el = menuBtnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const optionCount = APPLICATION_STATUSES.filter((s) => s !== currentStatus).length;
    const menuH = optionCount * 40 + 8;
    const spaceBelow = window.innerHeight - r.bottom;
    const top = spaceBelow >= menuH + 8 ? r.bottom + 4 : Math.max(8, r.top - menuH - 4);
    setMenuPos({ left: r.left, top, width: r.width });
    setShowMenu(true);
  }

  // Fixed popover doesn't follow the card when its column scrolls → close on scroll/resize.
  useEffect(() => {
    if (!showMenu) return;
    const close = () => closeMenu();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [showMenu]);

  function change(next: ApplicationStatus) {
    closeMenu();
    if (next === currentStatus) return;
    startTransition(async () => {
      try {
        await changeApplicationStatus(app.id, next);
        toast.success(`ย้ายไป "${STATUS_LABELS[next]}"`);
      } catch (e) {
        toast.error((e as Error).message);
      }
    });
  }

  const overdue = isOverdue(currentStatus, app.updatedAt);

  const selectable = canWrite && !!onToggleSelect;

  return (
    <div
      className={`relative rounded-xl p-2.5 transition-colors ${
        selected
          ? "border-2 border-[var(--color-brand-500)] bg-[var(--color-brand-50)]"
          : overdue
            ? "border-2 border-red-300 bg-gradient-to-br from-red-50 to-white"
            : "border border-zinc-200 bg-white hover:border-[var(--color-brand-400)]"
      }`}
    >
      {selectable && (
        // Checkbox toggles selection · stopPropagation so it never triggers the
        // card's <Link> navigation. Bigger tap target on top-left for mobile.
        <label
          className="absolute top-0 left-0 z-10 flex size-11 cursor-pointer items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.(app.id)}
            className="size-4 rounded border-zinc-300 text-[var(--color-brand-600)] accent-[var(--color-brand-600)] focus:ring-[var(--color-brand-400)]"
            aria-label={`เลือก ${app.applicantName}`}
          />
        </label>
      )}
      {overdue && (
        <div className={`mb-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded ${selectable ? "ml-10" : ""}`}>
          🔥 เกิน SLA
        </div>
      )}
      <Link href={cardHref} className={`block ${selectable ? "pl-7" : ""}`}>
        <div className="flex items-start justify-between gap-1.5">
          <p className="font-bold text-zinc-900 text-sm truncate flex-1">
            {app.applicantName}
            {app.flagged && (
              <span className="text-red-500 ml-1.5 text-xs" title="ติด Blacklist">
                ⚠
              </span>
            )}
          </p>
          {app.refId && (
            <span
              className="font-mono text-[11px] text-zinc-400 tabular-num shrink-0 mt-0.5"
              title={app.refId}
            >
              #{app.refId.slice(-6)}
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-500 mt-0.5 truncate">{app.posting}</p>
        <div className="flex items-center justify-between mt-2 text-xs">
          <span className="text-zinc-400">{app.phone}</span>
          <div className="flex items-center gap-2">
            {app.aiScore != null && (
              <span className="font-bold tabular-num text-[var(--color-brand-700)]">
                {app.aiScore}
              </span>
            )}
            {app.starRating != null && (
              <span className="text-amber-500">{"★".repeat(app.starRating)}</span>
            )}
          </div>
        </div>
        {/* Colored tags on card */}
        {app.tags && app.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {app.tags.slice(0, 4).map((raw) => {
              const { color, label } = parseTag(raw);
              return (
                <span
                  key={raw}
                  className={`inline-flex items-center text-[10px] font-bold px-1.5 py-0.5 rounded ${TAG_COLOR_CHIP[color]}`}
                >
                  {label}
                </span>
              );
            })}
            {app.tags.length > 4 && (
              <span className="text-[10px] text-zinc-400">+{app.tags.length - 4}</span>
            )}
          </div>
        )}
      </Link>
      {canWrite && (
        <div className="mt-2">
          <button
            ref={menuBtnRef}
            type="button"
            onClick={toggleMenu}
            className="w-full h-10 text-xs font-medium text-zinc-600 hover:text-zinc-900 border border-zinc-200 rounded-lg flex items-center justify-center gap-1"
          >
            ย้ายสถานะ <ChevronDown className="size-3.5" />
          </button>
          {showMenu && menuPos && (
            <>
              {/* backdrop closes on tap-away */}
              <div className="fixed inset-0 z-[60]" onClick={closeMenu} aria-hidden />
              <div
                className="fixed z-[61] rounded-xl border border-zinc-200 bg-white shadow-lg overflow-hidden"
                style={{ left: menuPos.left, top: menuPos.top, width: menuPos.width }}
              >
                {APPLICATION_STATUSES.filter((s) => s !== currentStatus).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => change(s)}
                    className="block w-full text-left px-3 h-10 text-sm text-zinc-700 hover:bg-zinc-50"
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
