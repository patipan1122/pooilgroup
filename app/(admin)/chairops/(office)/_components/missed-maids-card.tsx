// Missed maids card (Dashboard RIGHT, top) · mockup `dashboard.jsx` .co-missed.
//
// BF1 (2026-06-02) refresh:
//   • Rows now render 3 variants — missed_actual (red) / on_leave (amber w/
//     reason chip) / no_slot (zinc, "เปิดรับสมัคร {branch}" CTA).
//   • Bulk "ส่ง LINE OA" replaces legacy sms:phone1,phone2,... which most
//     OSes refused to dial. Server action posts to ops channel via
//     notifyChannel().
//   • Single-row phone is still tel: (single-number tap works everywhere).
//
// Cut-off countdown (17:00) is computed client-side and ticks each minute.

"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { MessageSquare, Phone, PlusCircle } from "lucide-react";
import { StatusDot } from "@/components/chairops/_kit";
import { baht } from "@/lib/chairops/utils/format";
import type { MissedMaidRow } from "@/lib/chairops/queries/exec-home";
import { pingMissedMaids } from "./missed-maids-actions";

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
  const [pending, startTransition] = useTransition();

  // Only "real misses" are pushable — leave + no_slot rows are informational.
  const pushable = rows.filter((r) => r.variant === "missed_actual");

  const onRemindAll = () => {
    if (pushable.length === 0) {
      toast.info("ไม่มีรายการให้แจ้งเตือน");
      return;
    }
    startTransition(async () => {
      const res = await pingMissedMaids(
        pushable.map((r) => ({ branchName: r.branchName, maidName: r.maidName })),
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`ส่ง LINE OA ออปส์แล้ว (${pushable.length} สาขา)`);
    });
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
          disabled={pushable.length === 0 || pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
        >
          <MessageSquare className="size-3" aria-hidden="true" />
          {pending ? "กำลังส่ง..." : "ส่ง LINE OA"}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="px-4 py-6 text-center text-sm text-emerald-600">
          ทุกแม่บ้านส่งยอดครบแล้ว ✓
        </div>
      ) : (
        <div className="py-1">
          {rows.map((b) => (
            <MissedMaidRowItem key={b.branchId} row={b} onOpen={() => router.push(`/chairops/reconcile/${b.branchId}`)} />
          ))}
        </div>
      )}
    </div>
  );
}

function MissedMaidRowItem({
  row,
  onOpen,
}: {
  row: MissedMaidRow;
  onOpen: () => void;
}) {
  // Variant tone — kept inline so screen-readers + visual users get the same
  // signal even if STATUS_DOT_TONE is overridden by a future theme.
  const bgClass =
    row.variant === "on_leave"
      ? "bg-amber-50/40 hover:bg-amber-100/60"
      : row.variant === "no_slot"
        ? "bg-zinc-50 hover:bg-zinc-100"
        : "hover:bg-zinc-50";

  // OWN-05 fix · single-row phone still uses tel: (one-number tap is
  // universally supported · only the bulk path was problematic with comma-list).
  return (
    <div
      onClick={onOpen}
      className={`flex cursor-pointer items-center gap-2.5 border-b border-zinc-100 px-4 py-2 last:border-b-0 ${bgClass}`}
    >
      <StatusDot tone={STATUS_DOT_TONE[row.status]} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-zinc-900">
          {row.branchName}
          {row.variant === "on_leave" && (
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-amber-800">
              ลา
              {row.dayOffReason ? ` · ${row.dayOffReason.slice(0, 20)}` : ""}
            </span>
          )}
          {row.variant === "no_slot" && (
            <span className="ml-2 inline-flex items-center rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10.5px] font-semibold text-zinc-700">
              ไม่มีแม่บ้าน
            </span>
          )}
        </div>
        <div className="truncate text-[11.5px] text-zinc-500">
          {row.variant === "no_slot"
            ? "เปิดรับสมัครได้"
            : row.maidName
              ? `${row.maidName}${row.maidPhone ? ` · ${row.maidPhone}` : ""}`
              : "ไม่มีแม่บ้านผูกบัญชี"}
        </div>
      </div>
      <div className="shrink-0 text-[11px] tabular-nums text-zinc-500">
        {baht(row.posToday)}
      </div>
      {/* DO NOT USE sms: COMMA · use notifyChannel · see OWN-05 audit fix */}
      {row.variant === "missed_actual" && row.maidPhone && (
        <a
          href={`tel:${row.maidPhone}`}
          onClick={(e) => e.stopPropagation()}
          className="grid size-7 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
          aria-label={`โทรหา ${row.maidName ?? "แม่บ้าน"}`}
        >
          <Phone className="size-3" aria-hidden="true" />
        </a>
      )}
      {row.variant === "no_slot" && (
        <Link
          href={`/chairops/users?new=MAID&branchId=${row.branchId}`}
          onClick={(e) => e.stopPropagation()}
          className="grid size-7 shrink-0 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-emerald-700"
          aria-label="เปิดรับสมัครแม่บ้าน"
        >
          <PlusCircle className="size-3" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
