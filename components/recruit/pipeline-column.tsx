"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
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
}

export function PipelineColumn({
  status,
  applications,
  canWrite,
  selectHref,
}: Props) {
  return (
    <div className="w-72 sm:w-auto shrink-0 sm:shrink rounded-2xl border border-zinc-200 bg-zinc-50/40 overflow-hidden flex flex-col max-h-[80vh]">
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
}: {
  app: AppCard;
  currentStatus: ApplicationStatus;
  canWrite: boolean;
  cardHref: string;
}) {
  const [showMenu, setShowMenu] = useState(false);
  const [, startTransition] = useTransition();

  function change(next: ApplicationStatus) {
    setShowMenu(false);
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

  return (
    <div
      className={`rounded-xl p-2.5 transition-colors ${
        overdue
          ? "border-2 border-red-300 bg-gradient-to-br from-red-50 to-white"
          : "border border-zinc-200 bg-white hover:border-[var(--color-brand-400)]"
      }`}
    >
      {overdue && (
        <div className="mb-1.5 inline-flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">
          🔥 เกิน SLA
        </div>
      )}
      <Link href={cardHref} className="block">
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
        <div className="relative mt-2">
          <button
            type="button"
            onClick={() => setShowMenu(!showMenu)}
            className="w-full h-10 text-xs font-medium text-zinc-600 hover:text-zinc-900 border border-zinc-200 rounded-lg flex items-center justify-center gap-1"
          >
            ย้ายสถานะ <ChevronDown className="size-3.5" />
          </button>
          {showMenu && (
            <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-zinc-200 bg-white shadow-lg z-20 overflow-hidden">
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
          )}
        </div>
      )}
    </div>
  );
}
