"use client";

// คำขออนุมัติแก้ — review queue for revert requests.
// • super_admin: "อนุมัติ" / "ปฏิเสธ" (with note) on PENDING requests
// • others: read-only view of their requests' status
// PENDING shown first; decided ones below with decider + note.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, ClipboardCheck, Clock } from "lucide-react";
import type { EditRequestRecord } from "@/lib/ledger/recon-controls";
import { approveRevertAction, rejectRevertAction } from "../_recon-controls-actions";
import { thDate, StatusBadge, ReasonModal, FeedbackBar } from "../_components/recon-controls-ui";

interface Props {
  requests: EditRequestRecord[];
  isSuper: boolean;
}

const baht2 = (s: number) =>
  (Math.abs(s) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ApprovalsClient({ requests, isSuper }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<EditRequestRecord | null>(null);
  const [rejectBusy, setRejectBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; message: string } | null>(null);

  const pendingReqs = requests.filter((r) => r.status === "PENDING");
  const decidedReqs = requests.filter((r) => r.status !== "PENDING");

  async function doApprove(id: string) {
    setBusy(id);
    const res = await approveRevertAction(id);
    setBusy(null);
    if (res.ok) {
      setFeedback({ kind: "ok", message: "อนุมัติแล้ว — รายการถูกย้อนและกลับไปรอจับคู่ใหม่" });
      startTransition(() => router.refresh());
    } else {
      setFeedback({ kind: "error", message: res.error ?? "อนุมัติไม่สำเร็จ" });
    }
  }

  async function doReject(note: string) {
    if (!rejectTarget) return;
    setRejectBusy(true);
    const res = await rejectRevertAction({ requestId: rejectTarget.id, note });
    setRejectBusy(false);
    if (res.ok) {
      setFeedback({ kind: "ok", message: "ปฏิเสธคำขอแล้ว" });
      setRejectTarget(null);
      startTransition(() => router.refresh());
    } else {
      setFeedback({ kind: "error", message: res.error ?? "ปฏิเสธไม่สำเร็จ" });
    }
  }

  return (
    <div className="space-y-5">
      {feedback && (
        <FeedbackBar kind={feedback.kind} message={feedback.message} onDismiss={() => setFeedback(null)} />
      )}

      {/* PENDING */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-700">
          <Clock size={15} className="text-amber-500" />
          รออนุมัติ
          <span className="rounded-full bg-amber-100 px-2 text-xs font-medium text-amber-700 tabular-num">
            {pendingReqs.length}
          </span>
        </h2>
        {pendingReqs.length === 0 ? (
          <EmptyRow text="ไม่มีคำขอที่รออนุมัติ" />
        ) : (
          <ul className="space-y-3">
            {pendingReqs.map((r) => (
              <RequestCard key={r.id} req={r}>
                {isSuper ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => doApprove(r.id)}
                      disabled={!!busy || pending}
                      className="press inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-sm font-semibold text-white hover:bg-emerald-700 focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50 sm:min-h-0 sm:py-2"
                    >
                      <Check size={15} />
                      {busy === r.id ? "กำลังอนุมัติ..." : "อนุมัติ"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFeedback(null);
                        setRejectTarget(r);
                      }}
                      disabled={!!busy || pending}
                      className="press inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-rose-200 px-3 text-sm font-medium text-rose-700 hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-rose-300 disabled:opacity-50 sm:min-h-0 sm:py-2"
                    >
                      <X size={15} />
                      ปฏิเสธ
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-400">รอ super admin อนุมัติ</p>
                )}
              </RequestCard>
            ))}
          </ul>
        )}
      </section>

      {/* DECIDED */}
      {decidedReqs.length > 0 && (
        <section>
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-700">
            <ClipboardCheck size={15} className="text-zinc-400" />
            ตัดสินแล้วล่าสุด
          </h2>
          <ul className="space-y-3">
            {decidedReqs.map((r) => (
              <RequestCard key={r.id} req={r}>
                <div className="text-xs text-zinc-500">
                  {r.status === "APPROVED" ? "อนุมัติโดย" : "ปฏิเสธโดย"} {r.decidedByName ?? "—"} ·{" "}
                  {thDate(r.decidedAt)}
                  {r.decisionNote && (
                    <span className="mt-0.5 block text-zinc-600">หมายเหตุ: {r.decisionNote}</span>
                  )}
                </div>
              </RequestCard>
            ))}
          </ul>
        </section>
      )}

      <ReasonModal
        open={!!rejectTarget}
        busy={rejectBusy}
        title="ปฏิเสธคำขอแก้"
        description="ระบุเหตุผลที่ปฏิเสธ — ผู้ขอจะได้รับแจ้ง"
        confirmLabel="ปฏิเสธคำขอ"
        confirmTone="rose"
        placeholder="เช่น รายการนี้ถูกต้องแล้ว / ให้ตรวจสอบใหม่..."
        onConfirm={doReject}
        onClose={() => setRejectTarget(null)}
      />
    </div>
  );
}

function RequestCard({
  req: r,
  children,
}: {
  req: EditRequestRecord;
  children: React.ReactNode;
}) {
  const hasDelta = r.deltaSatang !== 0;
  return (
    <li className="rounded-2xl border border-zinc-100 bg-white p-4 shadow-soft">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={r.status} />
        <span className="text-sm font-medium text-zinc-700">{r.accountLabel ?? "ทุกบัญชี"}</span>
        <span className="ml-auto text-xs text-zinc-400">ขอเมื่อ {thDate(r.requestedAt)}</span>
      </div>

      <p className="mt-2 text-sm text-zinc-700">
        <span className="text-zinc-400">เหตุผล:</span> {r.reason}
      </p>
      <p className="mt-0.5 text-xs text-zinc-400">โดย {r.requestedByName}</p>

      <div className="mt-3 grid grid-cols-3 divide-x divide-zinc-100 rounded-xl border border-zinc-100 bg-zinc-50/40 text-center">
        <div className="px-2 py-1.5">
          <p className="text-[10px] text-zinc-400">ฝั่งบัญชี</p>
          <p className="tabular-num text-xs font-semibold text-zinc-800">฿{baht2(r.bookTotalSatang)}</p>
        </div>
        <div className="px-2 py-1.5">
          <p className="text-[10px] text-zinc-400">ฝั่งธนาคาร</p>
          <p className="tabular-num text-xs font-semibold text-zinc-800">฿{baht2(r.bankTotalSatang)}</p>
        </div>
        <div className="px-2 py-1.5">
          <p className="text-[10px] text-zinc-400">ส่วนต่าง</p>
          <p className={`tabular-num text-xs font-semibold ${hasDelta ? "text-amber-600" : "text-emerald-600"}`}>
            ฿{baht2(r.deltaSatang)}
          </p>
        </div>
      </div>

      <div className="mt-3">{children}</div>
    </li>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 py-8 text-center text-sm text-zinc-400">
      {text}
    </div>
  );
}
