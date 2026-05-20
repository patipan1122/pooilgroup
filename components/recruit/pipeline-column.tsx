"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  STATUS_LABELS,
  STATUS_TONE,
  APPLICATION_STATUSES,
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
}

interface Props {
  status: ApplicationStatus;
  applications: AppCard[];
  canWrite: boolean;
}

export function PipelineColumn({ status, applications, canWrite }: Props) {
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
          <div className="text-center text-xs text-zinc-400 py-8 italic">
            ไม่มี
          </div>
        ) : (
          applications.map((a) => (
            <ApplicationCard
              key={a.id}
              app={a}
              currentStatus={status}
              canWrite={canWrite}
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
}: {
  app: AppCard;
  currentStatus: ApplicationStatus;
  canWrite: boolean;
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

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-2.5 hover:border-[var(--color-brand-400)] transition-colors">
      <Link href={`/recruit/applications/${app.id}`} className="block">
        <p className="font-bold text-zinc-900 text-sm truncate">
          {app.applicantName}
          {app.flagged && <span className="text-red-500 ml-1.5 text-xs">⚠</span>}
        </p>
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
      </Link>
      {canWrite && (
        <div className="relative mt-2">
          <button
            type="button"
            onClick={() => setShowMenu(!showMenu)}
            className="w-full text-[10px] text-zinc-500 hover:text-zinc-900 border border-zinc-200 rounded-lg py-1 flex items-center justify-center gap-1"
          >
            เปลี่ยน status <ChevronDown className="size-3" />
          </button>
          {showMenu && (
            <div className="absolute top-full left-0 right-0 mt-1 rounded-xl border border-zinc-200 bg-white shadow-lg z-20 overflow-hidden">
              {APPLICATION_STATUSES.filter((s) => s !== currentStatus).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => change(s)}
                  className="block w-full text-left px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50"
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
