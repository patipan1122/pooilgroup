// ClawFleet · Operations · Session grid (server component)
// Card grid of all sessions in filter scope. Cards delegate to <SessionCard>.
// Sections grouped by status: กำลังเก็บ → รอ review → ปิดแล้ว → อนุมัติแล้ว.
// Click card → ?focus=<code> opens drawer (handled inside SessionCard).

import { Activity, AlertTriangle, CheckCircle2, Lock } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { SessionCard, type SessionCardRow } from "./session-card";
import type { SessionStatus } from "@/lib/clawfleet/types";

interface Props {
  sessions: SessionCardRow[];
  activeFocus?: string;
}

type Bucket = {
  key: SessionStatus;
  label: string;
  icon: React.ReactNode;
  rows: SessionCardRow[];
};

// Deterministic display order — most-actionable first
const BUCKET_ORDER: SessionStatus[] = ["OPEN", "ANOMALY_REVIEW", "CLOSED", "LOCKED"];

const BUCKET_META: Record<SessionStatus, { label: string; icon: React.ReactNode }> = {
  OPEN: { label: "กำลังเก็บ", icon: <Activity className="h-3.5 w-3.5 text-blue-600" /> },
  ANOMALY_REVIEW: {
    label: "รอ review",
    icon: <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />,
  },
  CLOSED: {
    label: "ปิดแล้ว",
    icon: <CheckCircle2 className="h-3.5 w-3.5 text-zinc-500" />,
  },
  LOCKED: { label: "อนุมัติแล้ว", icon: <Lock className="h-3.5 w-3.5 text-emerald-600" /> },
};

export function SessionGrid({ sessions, activeFocus }: Props) {
  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={<Activity className="h-6 w-6" />}
        title="ยังไม่มีรอบเก็บใน scope นี้"
        description="ลองล้างฟิลเตอร์ · หรือกด 'เริ่มรอบใหม่' มุมขวาบน"
      />
    );
  }

  // Bucket sessions by status
  const buckets: Bucket[] = BUCKET_ORDER.map((key) => ({
    key,
    label: BUCKET_META[key].label,
    icon: BUCKET_META[key].icon,
    rows: sessions.filter((s) => s.status === key),
  })).filter((b) => b.rows.length > 0);

  return (
    <div className="space-y-6">
      {buckets.map((bucket) => (
        <section key={bucket.key}>
          {/* Sticky section header (z-10 below anomaly strip z-20) */}
          <div className="sticky top-[64px] z-10 -mx-1 mb-3 flex items-center gap-2 bg-zinc-50/95 px-1 py-1.5 backdrop-blur">
            {bucket.icon}
            <h3 className="text-sm font-semibold text-zinc-900">{bucket.label}</h3>
            <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[11px] font-bold tabular-nums text-zinc-700">
              {bucket.rows.length}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {bucket.rows.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                focused={activeFocus === s.sessionCode}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
