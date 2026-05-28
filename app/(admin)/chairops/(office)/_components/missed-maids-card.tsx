// Missed maids card (Dashboard RIGHT, top) · mockup `dashboard.jsx` .co-missed.
// Client island: row → reconcile detail · phone button → tel: link ·
// "ส่งเตือนทั้งหมด" → batch reminder (wired to onRemindAll handler stub).
//
// Cut-off countdown (17:00) is computed client-side and ticks each minute.

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Phone } from "lucide-react";
import { StatusDot } from "@/components/chairops/_kit";
import { baht } from "@/lib/chairops/utils/format";
import type { MissedMaidRow } from "@/lib/chairops/queries/exec-home";

// Inlined (not imported from exec-home.ts — that server module pulls prisma
// into the client bundle). Keep in sync with exec-home.MAID_CUTOFF_HOUR.
const MAID_CUTOFF_HOUR = 17;

const STATUS_DOT_TONE = {
  ok: "ok",
  warn: "warn",
  critical: "critical",
  missed: "critical",
} as const;

function useCutoffCountdown(): string {
  const [label, setLabel] = useState("—");
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const cutoff = new Date();
      cutoff.setHours(MAID_CUTOFF_HOUR, 0, 0, 0);
      const diffMs = cutoff.getTime() - now.getTime();
      if (diffMs <= 0) {
        setLabel("เลยเวลาแล้ว");
        return;
      }
      const totalMin = Math.floor(diffMs / 60000);
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      setLabel(`เหลือ ${h} ชม. ${m} นาที`);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);
  return label;
}

export function MissedMaidsCard({ rows }: { rows: MissedMaidRow[] }) {
  const router = useRouter();
  const countdown = useCutoffCountdown();

  const phones = rows.map((r) => r.maidPhone).filter(Boolean) as string[];
  const onRemindAll = () => {
    // Batch reminder · for now open SMS to all collected phones (LINE OA push
    // is Wave-2 per [[chairops-line-group-structure-current]]).
    if (phones.length === 0) return;
    window.location.href = `sms:${phones.join(",")}`;
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-4 pb-2.5 pt-3">
        <div>
          <div className="text-sm font-semibold text-zinc-900">
            แม่บ้านยังไม่ส่งวันนี้
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            cut-off {MAID_CUTOFF_HOUR}:00 · {countdown}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemindAll}
          disabled={phones.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
        >
          <Phone className="size-3" aria-hidden="true" />
          ส่งเตือนทั้งหมด
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-emerald-600">
          ทุกแม่บ้านส่งยอดครบแล้ว ✓
        </div>
      ) : (
        <div className="py-1">
          {rows.map((b) => (
            <div
              key={b.branchId}
              onClick={() => router.push(`/chairops/reconcile/${b.branchId}`)}
              className="flex cursor-pointer items-center gap-2.5 border-b border-zinc-100 px-4 py-2 last:border-b-0 hover:bg-zinc-50"
            >
              <StatusDot tone={STATUS_DOT_TONE[b.status]} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium text-zinc-900">
                  {b.branchName}
                </div>
                <div className="truncate text-[11.5px] text-zinc-500">
                  {b.maidName ?? "ไม่มีแม่บ้าน"}
                  {b.maidPhone ? ` · ${b.maidPhone}` : ""}
                </div>
              </div>
              <div className="shrink-0 text-[11px] tabular-nums text-zinc-500">
                {baht(b.posToday)}
              </div>
              {b.maidPhone && (
                <a
                  href={`tel:${b.maidPhone}`}
                  onClick={(e) => e.stopPropagation()}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                  aria-label={`โทรหา ${b.maidName ?? "แม่บ้าน"}`}
                >
                  <Phone className="size-3" aria-hidden="true" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
