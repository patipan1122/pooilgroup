// ClawFleet · Operations · SessionCard (server component)
// Single card render for SessionGrid. Extracted from inline grid so it can be
// reused (e.g., favourite-pinned strip, recent-row, group detail panel).
// Click → ?focus=<sessionCode> opens the right-side OpsDrawer.

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Lock,
  MapPin,
  User,
} from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { formatTHB } from "@/lib/clawfleet/validation";
import type { SessionStatus } from "@/lib/clawfleet/types";

type Tone = "neutral" | "success" | "info" | "danger" | "warning";

const STATUS_LABEL: Record<SessionStatus, string> = {
  OPEN: "กำลังเก็บ",
  CLOSED: "ปิดแล้ว",
  ANOMALY_REVIEW: "รอ review",
  LOCKED: "อนุมัติแล้ว",
};

const STATUS_TONE: Record<SessionStatus, Tone> = {
  OPEN: "info",
  CLOSED: "neutral",
  ANOMALY_REVIEW: "danger",
  LOCKED: "success",
};

export type SessionCardRow = {
  id: string;
  sessionCode: string;
  status: string;
  totalCashCents: number;
  openedAt: Date;
  closedAt: Date | null;
  group: {
    id: string;
    name: string;
    branch: { id: string; name: string; code: string };
  } | null;
  openedBy: { name: string | null } | null;
  _count: { events: number };
};

interface Props {
  session: SessionCardRow;
  focused?: boolean;
}

function statusIcon(status: SessionStatus) {
  if (status === "OPEN") return <Activity className="h-3 w-3" />;
  if (status === "ANOMALY_REVIEW") return <AlertTriangle className="h-3 w-3" />;
  if (status === "LOCKED") return <Lock className="h-3 w-3" />;
  return <CheckCircle2 className="h-3 w-3" />;
}

function formatDuration(start: Date, end: Date | null): string {
  const endTs = end ? end.getTime() : Date.now();
  const mins = Math.max(0, Math.round((endTs - start.getTime()) / 60000));
  if (mins < 60) return `${mins} นาที`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} ชม ${m > 0 ? `${m} นาที` : ""}`.trim();
}

export function SessionCard({ session: s, focused = false }: Props) {
  const status = s.status as SessionStatus;
  const tone = STATUS_TONE[status];
  const eventCount = s._count.events;

  return (
    <Link
      href={`/clawfleet/operations?focus=${s.sessionCode}`}
      scroll={false}
      className={`group block rounded-2xl border bg-white p-4 shadow-sm transition-all hover:shadow-md ${
        focused
          ? "border-blue-400 ring-2 ring-blue-200"
          : "border-zinc-200 hover:border-zinc-300"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <StatusPill tone={tone} dot>
          {statusIcon(status)}
          {STATUS_LABEL[status]}
        </StatusPill>
        <span className="font-mono text-xs text-zinc-400">{s.sessionCode}</span>
      </div>

      <div className="mt-3">
        <div className="truncate text-sm font-semibold text-zinc-900">
          {s.group?.name ?? "—"}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500">
          <MapPin className="h-3 w-3 shrink-0" />
          <span className="truncate">{s.group?.branch.name ?? "—"}</span>
          <span className="text-zinc-300">·</span>
          <span className="font-mono">{s.group?.branch.code ?? "—"}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3 text-xs text-zinc-600">
        <span className="inline-flex items-center gap-1">
          <User className="h-3 w-3" />
          <span className="truncate">{s.openedBy?.name ?? "—"}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock className="h-3 w-3" />
          <span className="tabular-nums">{formatDuration(s.openedAt, s.closedAt)}</span>
        </span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-2 border-t border-zinc-100 pt-3">
        <div>
          <div className="text-[11px] text-zinc-500">เก็บแล้ว</div>
          <div className="text-sm font-semibold tabular-nums text-zinc-900">
            {eventCount} ตู้
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-zinc-500">รายได้</div>
          <div className="text-base font-semibold tabular-nums text-zinc-900">
            {status === "OPEN" ? "—" : formatTHB(s.totalCashCents)}
          </div>
        </div>
      </div>
    </Link>
  );
}
