"use client";

// ClawFleet · Operations · Slide-in right drawer (400-560px)
// Shows session detail (focus=) or anomaly review (anomaly=).
// Keyboard: Esc=close · a=approve · r=recheck · e=escalate · n=next anomaly

import { useEffect, useTransition, useState, useCallback, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  X,
  Lock,
  AlertTriangle,
  CheckCircle2,
  Activity,
  Clock,
  User,
  ArrowUpRightFromSquare,
  Send,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { StatusPill } from "@/components/ui/status-pill";
import { formatTHB } from "@/lib/clawfleet/validation";
import { FLAG_LABEL_TH, FLAG_SEVERITY, type AnomalyFlag, type SessionStatus } from "@/lib/clawfleet/types";
import { reviewSession } from "@/lib/clawfleet/actions";
// TODO[claude-design](stub): escalateSession dedicated server action — Phase 1.5.
// Current behavior: reviewSession({decision:"REJECT", reviewNote:"[ESCALATE] ..."}).

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

// Loose type — drawer just renders what session has
type DrawerSession = {
  id: string;
  sessionCode: string;
  status: string;
  totalCashCents: number;
  openedAt: Date;
  closedAt: Date | null;
  anomalyFlags: string[];
  coinVarianceBps: number | null;
  exchangerCoinsOut: number | null;
  clawCoinsIn: number | null;
  group: {
    id: string;
    name: string;
    branch: { id: string; name: string; code: string };
  };
  openedBy: { name: string | null } | null;
  events: Array<{
    id: string;
    eventType: string;
    cashCountedCents: number;
    coinMeterBefore: number;
    coinMeterAfter: number;
    machine: { code: string; nickname: string | null; kind: string };
  }>;
};

interface Props {
  open: boolean;
  mode: "session" | "anomaly" | null;
  session: DrawerSession | null;
  prevAnomalyCode?: string;
  nextAnomalyCode?: string;
}

export function OpsDrawer({
  open,
  mode,
  session,
  prevAnomalyCode,
  nextAnomalyCode,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    const sp = new URLSearchParams(searchParams.toString());
    sp.delete("focus");
    sp.delete("anomaly");
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
  }, [router, pathname, searchParams]);

  const gotoAnomaly = useCallback(
    (code: string | undefined) => {
      if (!code) return;
      const sp = new URLSearchParams(searchParams.toString());
      sp.delete("focus");
      sp.set("anomaly", code);
      router.push(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  // Reset note when session changes (use ref-based dedup to avoid setState-in-effect lint)
  const lastSessionIdRef = useRef<string | null>(null);
  if (session?.id !== lastSessionIdRef.current) {
    lastSessionIdRef.current = session?.id ?? null;
    if (note !== "") setNote("");
    if (error !== null) setError(null);
  }

  // Esc to close + body scroll lock
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        return;
      }
      // Don't capture if user is typing in textarea/input
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;

      if (mode === "anomaly" && session) {
        if (e.key === "a") {
          e.preventDefault();
          submit("APPROVE");
        } else if (e.key === "r") {
          e.preventDefault();
          submit("REJECT");
        } else if (e.key === "e") {
          e.preventDefault();
          escalate();
        } else if (e.key === "n") {
          e.preventDefault();
          gotoAnomaly(nextAnomalyCode);
        } else if (e.key === "p") {
          e.preventDefault();
          gotoAnomaly(prevAnomalyCode);
        }
      }
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, session, note, prevAnomalyCode, nextAnomalyCode]);

  function submit(decision: "APPROVE" | "REJECT") {
    if (!session) return;
    if (note.length < 10) {
      setError("ใส่เหตุผลอย่างน้อย 10 ตัวอักษร");
      return;
    }
    setError(null);
    startTransition(async () => {
      const r = await reviewSession({
        sessionId: session.id,
        decision,
        reviewNote: note,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNote("");
      close();
      router.refresh();
    });
  }

  function escalate() {
    if (!session) return;
    // TODO[claude-design](stub): dedicated escalateSession action — Phase 1.5.
    // Fallback: REJECT with "[ESCALATE]" prefix + user-visible warning so MGR
    // knows this is a temporary path until full escalation routing ships.
    if (note.length < 10) {
      setError("ใส่เหตุผลก่อน escalate (10+ ตัวอักษร)");
      return;
    }
    toast.warning("Escalate ยังเป็น stub · บันทึกเป็น recheck พร้อม tag [ESCALATE] · routing ตัวจริง Phase 1.5");
    startTransition(async () => {
      const r = await reviewSession({
        sessionId: session.id,
        decision: "REJECT",
        reviewNote: `[ESCALATE] ${note}`,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setNote("");
      close();
      router.refresh();
    });
  }

  if (!open || !session) return null;

  const status = session.status as SessionStatus;
  const isAnomaly = mode === "anomaly";
  const showReviewActions = isAnomaly && status === "ANOMALY_REVIEW";

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-zinc-950/40 backdrop-blur-sm"
        onClick={close}
        aria-hidden
      />

      {/* Drawer */}
      <aside
        className="fixed right-0 top-0 z-50 flex h-full w-full flex-col bg-white shadow-lg sm:w-[480px] lg:w-[520px]"
        role="dialog"
        aria-modal="true"
      >
        {/* Sticky header */}
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-zinc-200 bg-white px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <StatusPill tone={STATUS_TONE[status]} dot>
                {status === "OPEN" && <Activity className="h-3 w-3" />}
                {status === "ANOMALY_REVIEW" && <AlertTriangle className="h-3 w-3" />}
                {status === "LOCKED" && <Lock className="h-3 w-3" />}
                {status === "CLOSED" && <CheckCircle2 className="h-3 w-3" />}
                {STATUS_LABEL[status]}
              </StatusPill>
              <span className="font-mono text-xs text-zinc-400">{session.sessionCode}</span>
            </div>
            <h2 className="mt-2 truncate text-lg font-semibold text-zinc-900">
              {session.group.name}
            </h2>
            <p className="truncate text-xs text-zinc-500">
              {session.group.branch.name} · เปิดโดย {session.openedBy?.name ?? "—"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {isAnomaly && (
              <>
                <button
                  type="button"
                  onClick={() => gotoAnomaly(prevAnomalyCode)}
                  disabled={!prevAnomalyCode}
                  className="grid size-9 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent"
                  aria-label="ก่อนหน้า (p)"
                  title="ก่อนหน้า (p)"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  onClick={() => gotoAnomaly(nextAnomalyCode)}
                  disabled={!nextAnomalyCode}
                  className="grid size-9 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100 disabled:opacity-30 disabled:hover:bg-transparent"
                  aria-label="ถัดไป (n)"
                  title="ถัดไป (n)"
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={close}
              className="grid size-9 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100"
              aria-label="ปิด"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        {/* Body · scrollable */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              <div className="text-[11px] text-zinc-500">รายได้รอบนี้</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-zinc-900">
                {status === "OPEN" ? "—" : formatTHB(session.totalCashCents)}
              </div>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              <div className="text-[11px] text-zinc-500">ตู้ที่เก็บ</div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-zinc-900">
                {session.events.filter((e) => e.eventType === "COLLECTION").length} ตู้
              </div>
            </div>
          </div>

          {/* Time meta */}
          <div className="rounded-xl border border-zinc-100 bg-zinc-50 p-3 text-xs">
            <div className="flex items-center justify-between text-zinc-600">
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                เปิด
              </span>
              <span className="tabular-nums">
                {new Date(session.openedAt).toLocaleString("th-TH", {
                  day: "2-digit",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            {session.closedAt && (
              <div className="mt-1 flex items-center justify-between text-zinc-600">
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  ปิด
                </span>
                <span className="tabular-nums">
                  {new Date(session.closedAt).toLocaleString("th-TH", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            )}
            <div className="mt-1 flex items-center justify-between text-zinc-600">
              <span className="inline-flex items-center gap-1">
                <User className="h-3 w-3" />
                พนักงาน
              </span>
              <span>{session.openedBy?.name ?? "—"}</span>
            </div>
          </div>

          {/* Cross-check (CLOSED+) */}
          {status !== "OPEN" && session.coinVarianceBps != null && (
            <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-3">
              <div className="flex items-center justify-between text-xs font-semibold text-indigo-900">
                <span>Cross-check ตู้แลก ↔ ตู้คีบ</span>
                <span className="font-mono tabular-nums">
                  ห่าง {(session.coinVarianceBps / 100).toFixed(2)}%
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-md bg-white px-2 py-1.5">
                  <div className="text-zinc-500">ตู้แลกแจก</div>
                  <div className="font-semibold tabular-nums text-zinc-900">
                    {session.exchangerCoinsOut ?? 0} เหรียญ
                  </div>
                </div>
                <div className="rounded-md bg-white px-2 py-1.5">
                  <div className="text-zinc-500">ตู้คีบรับ</div>
                  <div className="font-semibold tabular-nums text-zinc-900">
                    {session.clawCoinsIn ?? 0} เหรียญ
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Anomaly flags */}
          {isAnomaly && session.anomalyFlags.length > 0 && (
            <section className="rounded-xl border border-rose-200 bg-rose-50 p-3">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-rose-700">
                <AlertTriangle className="h-4 w-4" />
                Anomaly · {session.anomalyFlags.length} flag
              </div>
              <ul className="mt-2 space-y-1">
                {session.anomalyFlags.map((f) => {
                  const sev = FLAG_SEVERITY[f as AnomalyFlag];
                  return (
                    <li key={f} className="flex items-start gap-2 text-xs">
                      <span
                        className={`mt-0.5 inline-flex h-4 w-7 shrink-0 items-center justify-center rounded text-[10px] font-bold ${
                          sev === "P0"
                            ? "bg-rose-200 text-rose-800"
                            : sev === "P1"
                              ? "bg-amber-200 text-amber-800"
                              : "bg-zinc-200 text-zinc-700"
                        }`}
                      >
                        {sev}
                      </span>
                      <span className="text-rose-900">
                        {FLAG_LABEL_TH[f as AnomalyFlag] ?? f}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Events list */}
          <section>
            <h3 className="mb-2 text-xs font-semibold text-zinc-500">
              รายการเก็บ ({session.events.length})
            </h3>
            <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white">
              {session.events.length === 0 && (
                <li className="px-3 py-4 text-center text-xs text-zinc-400">ยังไม่มี event</li>
              )}
              {session.events.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <span
                    className={`inline-flex h-5 px-1.5 items-center justify-center rounded text-[10px] font-bold ${
                      e.machine.kind === "CLAW"
                        ? "bg-blue-100 text-blue-700"
                        : "bg-zinc-200 text-zinc-700"
                    }`}
                  >
                    {e.machine.kind === "CLAW" ? "ตู้คีบ" : "ตู้แลก"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-mono font-semibold text-zinc-900">
                      {e.machine.code}
                    </span>
                    {e.machine.nickname && (
                      <span className="ml-1 text-zinc-500">{e.machine.nickname}</span>
                    )}
                  </span>
                  <span className="text-zinc-500 tabular-nums">
                    +{e.coinMeterAfter - e.coinMeterBefore}
                  </span>
                  <span className="font-semibold tabular-nums text-zinc-900">
                    {formatTHB(e.cashCountedCents)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {/* Review form (anomaly + status=REVIEW) */}
          {showReviewActions && (
            <section className="rounded-xl border border-zinc-200 bg-white p-4">
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">Review โดยหัวหน้า</h3>
              <textarea
                className="w-full rounded-lg border border-zinc-300 p-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-200"
                rows={3}
                placeholder="เหตุผล / หลักฐาน / สิ่งที่ตรวจสอบ (อย่างน้อย 10 ตัวอักษร)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={pending}
              />
              {error && (
                <div className="mt-2 rounded-lg border border-rose-300 bg-rose-50 p-2 text-xs text-rose-800">
                  {error}
                </div>
              )}
              <p className="mt-2 text-[11px] text-zinc-400">
                ⌨ Esc ปิด · a อนุมัติ · r recheck · e escalate · n ถัดไป · p ก่อนหน้า
              </p>
            </section>
          )}

          {/* Open in full page link */}
          <div className="pt-2">
            <a
              href={`/clawfleet/sessions/${session.id}`}
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
            >
              เปิดดูแบบเต็มหน้า
              <ArrowUpRightFromSquare className="h-3 w-3" />
            </a>
          </div>
        </div>

        {/* Sticky footer · action bar */}
        {showReviewActions ? (
          <footer className="flex shrink-0 items-center gap-2 border-t border-zinc-200 bg-white px-5 py-3">
            <button
              type="button"
              onClick={escalate}
              disabled={pending}
              className="inline-flex items-center justify-center gap-1 rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              title="Escalate (e)"
            >
              <Send className="h-3.5 w-3.5" />
              Escalate
            </button>
            <button
              type="button"
              onClick={() => submit("REJECT")}
              disabled={pending}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-semibold text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
              title="Recheck (r)"
            >
              <RotateCcw className="h-4 w-4" />
              ขอ Recheck
            </button>
            <button
              type="button"
              onClick={() => submit("APPROVE")}
              disabled={pending}
              className="flex-1 inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:bg-zinc-300"
              title="Approve (a)"
            >
              <CheckCircle2 className="h-4 w-4" />
              อนุมัติ
            </button>
          </footer>
        ) : (
          <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-zinc-200 bg-white px-5 py-3 text-xs text-zinc-500">
            <span>กด Esc เพื่อปิด</span>
            <button
              type="button"
              onClick={close}
              className="rounded-md px-3 py-1.5 font-medium text-zinc-700 hover:bg-zinc-100"
            >
              ปิด
            </button>
          </footer>
        )}
      </aside>
    </>
  );
}
