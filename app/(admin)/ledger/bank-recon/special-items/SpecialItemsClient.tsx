"use client";

// รายการพิเศษ (ทุกบัญชี) — aggregates ACROSS ALL ACCOUNTS. Two sections:
//   (a) โยกเงินภายใน — internal transfers (cross-account, both legs)
//   (b) ข้าม/ไม่มีคู่  — skipped/excluded bank items (reason · account · date · amount)
// super_admin/admin can pull a skipped item back with "เอากลับมา" (unExcludeAction).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, ArrowRight, RotateCcw, Sparkles, SkipForward, Loader2 } from "lucide-react";
import type { TransferRecord, SkippedRecord } from "@/lib/ledger/recon-controls";
import { unExcludeAction } from "../_recon-controls-actions";
import { Money, baht, thDate, StatusBadge, FeedbackBar } from "../_components/recon-controls-ui";

interface Props {
  transfers: TransferRecord[];
  skipped: SkippedRecord[];
  canUnExclude: boolean;
}

export function SpecialItemsClient({ transfers, skipped, canUnExclude }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  async function doUnExclude(matchId: string) {
    setBusy(matchId);
    const res = await unExcludeAction(matchId);
    setBusy(null);
    if (res.ok) {
      setFeedback({ kind: "ok", message: "เอารายการกลับมาแล้ว — กลับไปรอจับคู่ในหน้ากระทบยอด" });
      startTransition(() => router.refresh());
    } else {
      setFeedback({ kind: "error", message: res.error ?? "ทำรายการไม่สำเร็จ" });
    }
  }

  return (
    <div className="space-y-6">
      {feedback && (
        <FeedbackBar kind={feedback.kind} message={feedback.message} onDismiss={() => setFeedback(null)} />
      )}

      {/* (a) transfers */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-700">
          <ArrowLeftRight size={15} className="text-violet-500" />
          โยกเงินภายใน
          <span className="rounded-full bg-zinc-100 px-2 text-xs text-zinc-400 tabular-num">{transfers.length}</span>
        </h2>
        {transfers.length === 0 ? (
          <EmptyRow icon="transfer" text="ยังไม่มีการโยกเงินภายใน" />
        ) : (
          <ul className="space-y-2.5">
            {transfers.map((t) => (
              <TransferCard key={t.id} transfer={t} />
            ))}
          </ul>
        )}
      </section>

      {/* (b) skipped */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-700">
          <SkipForward size={15} className="text-amber-500" />
          ข้าม / ไม่มีคู่
          <span className="rounded-full bg-zinc-100 px-2 text-xs text-zinc-400 tabular-num">{skipped.length}</span>
        </h2>
        {skipped.length === 0 ? (
          <EmptyRow icon="skip" text="ไม่มีรายการที่ข้ามไว้" />
        ) : (
          <ul className="space-y-2.5">
            {skipped.map((s) => (
              <SkippedCard
                key={s.matchId}
                item={s}
                canUnExclude={canUnExclude}
                busy={busy === s.matchId}
                disabled={!!busy || pending}
                onUnExclude={() => {
                  setFeedback(null);
                  void doUnExclude(s.matchId);
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TransferCard({ transfer: t }: { transfer: TransferRecord }) {
  const out = t.legs.find((l) => l.amountSatang < 0) ?? t.legs[0];
  const inn = t.legs.find((l) => l.amountSatang > 0) ?? t.legs[1];
  const amount = Math.abs(out?.amountSatang ?? inn?.amountSatang ?? 0);
  return (
    <li className="rounded-2xl border border-zinc-100 bg-white p-3 shadow-soft">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700">โยกเงิน</span>
        {t.status !== "confirmed" && <StatusBadge status={t.status} />}
        <span className="ml-auto text-xs text-zinc-400">{thDate(t.createdAt)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        {out && (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-zinc-400">จาก</span>
            <span className="font-medium text-zinc-700">{out.accountLabel ?? "—"}</span>
          </span>
        )}
        <ArrowRight size={15} className="text-zinc-400" />
        {inn && (
          <span className="inline-flex items-center gap-1.5">
            <span className="text-zinc-400">เข้า</span>
            <span className="font-medium text-zinc-700">{inn.accountLabel ?? "—"}</span>
          </span>
        )}
        <span className="ml-auto tabular-num font-semibold text-zinc-800">฿{baht(amount)}</span>
      </div>
      {t.note && <p className="mt-1 text-xs text-zinc-400">{t.note}</p>}
    </li>
  );
}

function SkippedCard({
  item: s,
  canUnExclude,
  busy,
  disabled,
  onUnExclude,
}: {
  item: SkippedRecord;
  canUnExclude: boolean;
  busy: boolean;
  disabled: boolean;
  onUnExclude: () => void;
}) {
  return (
    <li className="rounded-2xl border border-zinc-100 bg-white p-3 shadow-soft">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">ข้ามไว้</span>
            <span className="text-sm font-medium text-zinc-700">{s.accountLabel ?? "—"}</span>
            <span className="text-xs text-zinc-400">· {thDate(s.date)}</span>
          </div>
          <p className="mt-1 truncate text-sm text-zinc-700">{s.description}</p>
          {s.reason && <p className="mt-0.5 text-xs text-zinc-400">เหตุผล: {s.reason}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Money satang={s.amountSatang} className="text-sm" />
          {canUnExclude && (
            <button
              type="button"
              onClick={onUnExclude}
              disabled={disabled}
              className="press inline-flex min-h-11 items-center gap-1 rounded-xl border border-brand-200 px-2.5 text-xs font-medium text-brand-700 hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-50 sm:min-h-0 sm:py-1.5"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              เอากลับมา
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function EmptyRow({ icon, text }: { icon: "transfer" | "skip"; text: string }) {
  const Icon = icon === "transfer" ? ArrowLeftRight : Sparkles;
  return (
    <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 py-8 text-center">
      <Icon size={24} className="mx-auto mb-1.5 text-zinc-300" />
      <p className="text-sm text-zinc-400">{text}</p>
    </div>
  );
}
