"use client";

// ReconcileBoard — the 4-bucket worklist for the accountant (WFH).
//   รอโอน · จ่ายบางส่วน · จ่ายแล้ว · ต้องตรวจ
// Read-only EXCEPT one allowed mutation: pairing a floating slip to an open
// request (assignSlipToRequestAction), shown only in "ต้องตรวจ" and only for
// users with the confirm capability. Each row = ONE payment request (vendor ·
// expectedTransfer big · bill count, expandable to bill docCodes) + a status pill.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  Banknote,
  Check,
  ChevronDown,
  ChevronRight,
  ImageOff,
  Link2,
  Loader2,
  ReceiptText,
  Send,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  assignSlipToRequestAction,
  cancelPaymentRequestAction,
  resendPaymentRequestAction,
} from "../../_actions";
import type {
  ReconcileRequestRow,
  ReconcileFloatingSlip,
} from "@/lib/ledger/payment-request-queries";

type BucketKey = "awaiting" | "partial" | "paid" | "abnormal";

const baht = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Status pill tones mapped to the Pool Badge palette (gray/blue/green/red).
const STATE_PILL: Record<
  string,
  { label: string; tone: "neutral" | "info" | "success" | "danger" | "warning" }
> = {
  open: { label: "รอโอน", tone: "neutral" },
  partial: { label: "จ่ายบางส่วน", tone: "info" },
  paid: { label: "จ่ายแล้ว", tone: "success" },
  abnormal: { label: "ต้องตรวจ", tone: "danger" },
  cancelled: { label: "ยกเลิก", tone: "neutral" },
  reversed: { label: "ทำรายการคืน", tone: "warning" },
};

function StatePill({ state }: { state: string }) {
  const meta = STATE_PILL[state] ?? STATE_PILL.open;
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

const TABS: Array<{ key: BucketKey; label: string }> = [
  { key: "awaiting", label: "รอโอน" },
  { key: "partial", label: "จ่ายบางส่วน" },
  { key: "paid", label: "จ่ายแล้ว" },
  { key: "abnormal", label: "ต้องตรวจ" },
];

// Segment tone per bucket. impeccable critique 2026-06-10: เดิมเป็น 5 การ์ด
// hero-metric เหมือนกันเป๊ะ (AI-slop card-grid + ตัวเลขใหญ่ลอย) → เปลี่ยนเป็น
// "แถบสรุป segmented" แถบเดียว แบ่งช่อง เส้นคั่นบาง. active = แถบบนสี + พื้นจาง.
const TONE: Record<BucketKey, { num: string; seg: string }> = {
  awaiting: { num: "text-amber-600", seg: "border-t-amber-400 bg-amber-50" },
  partial: { num: "text-blue-600", seg: "border-t-blue-400 bg-blue-50" },
  paid: { num: "text-emerald-600", seg: "border-t-emerald-400 bg-emerald-50" },
  abnormal: { num: "text-rose-600", seg: "border-t-rose-400 bg-rose-50" },
};

function RequestRow({ req, canCancel }: { req: ReconcileRequestRow; canCancel: boolean }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  // Cancel only makes sense before the request is paid/cancelled.
  const cancellable = ["open", "partial", "abnormal"].includes(req.state);
  // Resend the LINE card — only while still unmatched (open/partial). CEO 2026-07-25.
  const resendable = ["open", "partial"].includes(req.state);
  const [resent, setResent] = useState(false);

  function doCancel() {
    setErr(null);
    start(async () => {
      const res = await cancelPaymentRequestAction(req.id);
      if (res.ok) router.refresh();
      else {
        setErr(res.error ?? "ยกเลิกไม่สำเร็จ");
        setConfirm(false);
      }
    });
  }

  function doResend() {
    setErr(null);
    start(async () => {
      const res = await resendPaymentRequestAction(req.id);
      if (res.ok) {
        setResent(true);
        router.refresh();
      } else setErr(res.error ?? "ส่งขอโอนซ้ำไม่สำเร็จ");
    });
  }

  return (
    <li className="rounded-xl border border-zinc-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-zinc-50"
      >
        <span className="text-zinc-400">
          {open ? (
            <ChevronDown className="size-4" aria-hidden />
          ) : (
            <ChevronRight className="size-4" aria-hidden />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-zinc-800">
              {req.vendor || "ไม่ระบุผู้ขาย"}
            </span>
            <StatePill state={req.state} />
          </div>
          <p className="mt-0.5 truncate text-xs text-zinc-400">
            {req.bills.length} ใบ
            {req.whtTotal > 0 ? ` · หัก ณ ที่จ่าย ${baht(req.whtTotal)}` : ""}
            {req.paidTotal > 0 ? ` · จ่ายแล้ว ${baht(req.paidTotal)}` : ""}
            {req.paidAt ? ` · ${req.paidAt.slice(0, 10)}` : ""}
          </p>
          {req.abnormalReason && (
            <p className="mt-0.5 truncate text-xs text-rose-600">⚠ {req.abnormalReason}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-base font-bold tabular-nums text-zinc-900">
            {baht(req.expectedTransfer)}
          </div>
          <div className="text-[11px] text-zinc-400">ยอดที่ต้องโอน</div>
          {req.paidTotal > 0 && Math.abs(req.paidTotal - req.expectedTransfer) > 0.01 && (
            <span
              className={
                "mt-1 inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums " +
                (req.paidTotal > req.expectedTransfer
                  ? "bg-amber-100 text-amber-700"
                  : "bg-rose-100 text-rose-700")
              }
            >
              {req.paidTotal > req.expectedTransfer ? "โอนเกิน" : "โอนขาด"}{" "}
              {baht(Math.abs(req.paidTotal - req.expectedTransfer))}
            </span>
          )}
        </div>
      </button>

      {open && (
        <ul className="border-t border-zinc-100 px-3 py-2">
          {req.bills.length === 0 && (
            <li className="py-1 text-xs text-zinc-400">ไม่มีบิลในคำขอนี้แล้ว</li>
          )}
          {req.bills.map((b) => (
            <li
              key={b.expenseId}
              className="flex items-center justify-between gap-2 py-1 text-xs"
            >
              <span className="flex items-center gap-1.5 truncate text-zinc-600">
                <ReceiptText className="size-3.5 shrink-0 text-zinc-400" aria-hidden />
                <span className="font-mono">{b.docCode}</span>
              </span>
              <span className="shrink-0 tabular-nums text-zinc-700">
                {baht(b.amount)}
                {b.wht > 0 ? (
                  <span className="text-zinc-400"> − {baht(b.wht)}</span>
                ) : null}
              </span>
            </li>
          ))}
          <li className="mt-1 flex items-center justify-between border-t border-zinc-100 pt-1.5 text-xs font-medium text-zinc-700">
            <span>รวมก่อนหัก {baht(req.billsGross)}</span>
            <span className="tabular-nums">ต้องโอน {baht(req.expectedTransfer)}</span>
          </li>
          {/* ยอดขอโอน vs ยอดในสลิปจริง + ผลต่าง (โอนเกิน/ขาด) — derive จาก paidTotal */}
          {req.paidTotal > 0 && (
            <>
              <li className="mt-0.5 flex items-center justify-between text-xs text-zinc-600">
                <span>ยอดในสลิป (ที่โอนจริง)</span>
                <span className="tabular-nums font-medium">{baht(req.paidTotal)}</span>
              </li>
              {Math.abs(req.paidTotal - req.expectedTransfer) > 0.01 ? (
                <li
                  className={
                    "mt-1 flex items-center justify-between rounded-md px-2 py-1 text-xs font-bold " +
                    (req.paidTotal > req.expectedTransfer
                      ? "bg-amber-50 text-amber-700"
                      : "bg-rose-50 text-rose-700")
                  }
                >
                  <span>
                    {req.paidTotal > req.expectedTransfer ? "โอนเกิน" : "โอนขาด"}
                  </span>
                  <span className="tabular-nums">
                    {baht(Math.abs(req.paidTotal - req.expectedTransfer))} ฿
                  </span>
                </li>
              ) : (
                <li className="mt-1 flex items-center justify-between rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                  <span>ยอดตรงพอดี</span>
                  <span className="tabular-nums">✓</span>
                </li>
              )}
            </>
          )}
          {/* audit-trail + slip evidence (audit P1/P3) */}
          {(req.requestedByName || req.paidBy || req.transRef || req.slipUrl) && (
            <li className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-zinc-100 pt-1.5 text-[11px] text-zinc-500">
              {req.requestedByName && <span>ผู้ขอ: {req.requestedByName}</span>}
              {req.paidBy && <span>จ่าย: {req.paidBy.slice(0, 10)}…</span>}
              {req.transRef && <span className="font-mono">อ้างอิง {req.transRef}</span>}
              {req.slipUrl && (
                <a
                  href={req.slipUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-[var(--color-brand-600)] hover:underline"
                >
                  <ReceiptText className="size-3.5" aria-hidden />
                  ดูสลิป
                </a>
              )}
            </li>
          )}
        </ul>
      )}
      {open && canCancel && cancellable && (
        <div className="border-t border-zinc-100 px-3 py-2">
          {confirm ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-rose-600">ยกเลิกคำขอ? บิลจะกลับเป็น &ldquo;ยังไม่จ่าย&rdquo;</span>
              <button
                type="button"
                onClick={doCancel}
                disabled={pending}
                className="inline-flex h-7 items-center gap-1 rounded-lg bg-rose-600 px-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Ban className="size-3.5" aria-hidden />}
                ยืนยันยกเลิก
              </button>
              <button
                type="button"
                onClick={() => setConfirm(false)}
                disabled={pending}
                className="inline-flex h-7 items-center rounded-lg border border-zinc-200 px-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
              >
                ไม่
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {resendable && (
                <button
                  type="button"
                  onClick={doResend}
                  disabled={pending || resent}
                  className="inline-flex h-7 items-center gap-1 rounded-lg text-xs font-medium text-[var(--color-brand-600)] hover:bg-zinc-50 disabled:opacity-50"
                >
                  {resent ? (
                    <Check className="size-3.5" aria-hidden />
                  ) : (
                    <Send className="size-3.5" aria-hidden />
                  )}
                  {resent ? "ส่งซ้ำแล้ว" : "ส่งขอโอนซ้ำ"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setConfirm(true)}
                disabled={pending}
                className="inline-flex h-7 items-center gap-1 rounded-lg text-xs font-medium text-rose-600 hover:bg-rose-50"
              >
                <Ban className="size-3.5" aria-hidden />
                ยกเลิกคำขอ
              </button>
            </div>
          )}
          {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}
        </div>
      )}
    </li>
  );
}

function RequestList({
  rows,
  emptyHint,
  canCancel,
}: {
  rows: ReconcileRequestRow[];
  emptyHint: string;
  canCancel: boolean;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center text-sm text-zinc-500">
        {emptyHint}
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
      {rows.map((r) => (
        <RequestRow key={r.id} req={r} canCancel={canCancel} />
      ))}
    </ul>
  );
}

function FloatingSlipCard({
  slip,
  openRequests,
  canMatch,
}: {
  slip: ReconcileFloatingSlip;
  openRequests: Array<{ id: string; vendor: string | null; expectedTransfer: number }>;
  canMatch: boolean;
}) {
  // Suggest requests whose remaining ≈ slip amount first (helps pick the right one).
  const sorted = useMemo(() => {
    const near = openRequests.filter(
      (r) => Math.abs(r.expectedTransfer - slip.amount) < 0.005,
    );
    const rest = openRequests.filter(
      (r) => Math.abs(r.expectedTransfer - slip.amount) >= 0.005,
    );
    return [...near, ...rest];
  }, [openRequests, slip.amount]);

  const router = useRouter();
  const [requestId, setRequestId] = useState(sorted[0]?.id ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function assign() {
    if (!requestId) return;
    setErr(null);
    start(async () => {
      const res = await assignSlipToRequestAction(slip.id, requestId);
      if (res.ok) {
        setDone(true);
        // P2 (bug-hunt) — refresh so buckets/counts/totals reflect the close.
        router.refresh();
      } else setErr(res.error ?? "จับคู่ไม่สำเร็จ");
    });
  }

  if (done) {
    return (
      <li className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
        ✅ จับคู่สลิป {baht(slip.amount)} บาท กับคำขอโอนเรียบร้อย
      </li>
    );
  }

  return (
    <li className="rounded-xl border border-rose-200 bg-rose-50/40 p-3">
      <div className="flex gap-3">
        {slip.slipThumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={slip.slipThumbUrl}
            alt="สลิป"
            className="size-16 shrink-0 rounded-lg border border-zinc-200 object-cover"
          />
        ) : (
          <div className="grid size-16 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-300">
            <ImageOff className="size-5" aria-hidden />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800">
            <Banknote className="size-4 text-emerald-600" aria-hidden />
            {baht(slip.amount)} บาท
          </p>
          <p className="mt-0.5 truncate text-xs text-zinc-500">
            {slip.sendingBank ? `ธนาคาร ${slip.sendingBank} · ` : ""}
            {slip.transRef
              ? `อ้างอิง ${slip.transRef}`
              : slip.qrDecoded
                ? "อ่าน QR แล้ว"
                : "ไม่มี QR (อ่านยอดด้วย AI)"}
          </p>
          <p className="mt-0.5 text-[11px] text-rose-500">สลิปลอย — ยังไม่ผูกกับคำขอโอน</p>
        </div>
      </div>

      {canMatch ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            value={requestId}
            onChange={(e) => setRequestId(e.target.value)}
            disabled={pending}
            aria-label="เลือกคำขอโอนที่จะจับคู่"
            className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
          >
            {sorted.length === 0 && <option value="">— ไม่มีคำขอที่ยังเปิดอยู่ —</option>}
            {sorted.map((r) => (
              <option key={r.id} value={r.id}>
                {r.vendor ?? "ไม่ระบุผู้ขาย"} · {baht(r.expectedTransfer)}
                {Math.abs(r.expectedTransfer - slip.amount) < 0.005 ? " ✓ยอดตรง" : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={assign}
            disabled={pending || !requestId}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--color-brand-600)] px-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Link2 className="size-4" aria-hidden />
            )}
            จับคู่กับคำขอ
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-zinc-400">เฉพาะบัญชี/ผู้ดูแลจับคู่สลิปได้</p>
      )}
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
    </li>
  );
}

export function ReconcileBoard({
  awaiting,
  partial,
  paid,
  abnormal,
  floatingSlips,
  summary,
  canMatch,
}: {
  awaiting: ReconcileRequestRow[];
  partial: ReconcileRequestRow[];
  paid: ReconcileRequestRow[];
  abnormal: ReconcileRequestRow[];
  floatingSlips: ReconcileFloatingSlip[];
  summary: Record<BucketKey, { count: number; expectedTotal: number }>;
  canMatch: boolean;
}) {
  const [tab, setTab] = useState<BucketKey | "diff">("awaiting");

  // Open/partial requests are the valid targets for pairing a floating slip.
  const openTargets = useMemo(
    () =>
      [...awaiting, ...partial].map((r) => ({
        id: r.id,
        vendor: r.vendor,
        expectedTransfer: r.expectedTransfer,
      })),
    [awaiting, partial],
  );

  // "มีผลต่าง" — ใบที่มีสลิปแล้วแต่ยอดโอนไม่ตรง (โอนเกิน/ขาด). derive ฝั่ง client,
  // ไม่ query เพิ่ม: diff = ยอดในสลิป(paidTotal) − ยอดต้องโอนสุทธิ(expectedTransfer).
  const diffRows = useMemo(() => {
    const all = [...partial, ...paid, ...abnormal];
    const seen = new Set<string>();
    return all
      .filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return r.paidTotal > 0 && Math.abs(r.paidTotal - r.expectedTransfer) > 0.01;
      })
      .sort(
        (a, b) =>
          Math.abs(b.paidTotal - b.expectedTransfer) -
          Math.abs(a.paidTotal - a.expectedTransfer),
      );
  }, [partial, paid, abnormal]);
  const diffNet = useMemo(
    () => diffRows.reduce((s, r) => s + (r.paidTotal - r.expectedTransfer), 0),
    [diffRows],
  );

  // เรียงลำดับ (client-side; default = ลำดับจาก server = ล่าสุด).
  const [sort, setSort] = useState<"recent" | "amount-desc" | "amount-asc">("recent");
  const applySort = (rows: ReconcileRequestRow[]) => {
    if (sort === "amount-desc")
      return [...rows].sort((a, b) => b.expectedTransfer - a.expectedTransfer);
    if (sort === "amount-asc")
      return [...rows].sort((a, b) => a.expectedTransfer - b.expectedTransfer);
    return rows;
  };

  return (
    <div>
      {/* MOBILE: compact pill-rail (LeanUX ③#3 — the prominent KPI cards ate the
          mobile first-viewport; keep the cards on desktop, give phones a 1-row rail
          driving the same tab state). CEO 2026-06-08 cards stay on sm+. */}
      <div
        role="tablist"
        aria-label="กลุ่มสถานะการจ่าย"
        className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 sm:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => setTab(t.key)}
              className={
                "inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-full border px-3 text-sm font-medium transition-colors " +
                (active
                  ? "border-[var(--color-brand-300)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
                  : "border-zinc-200 bg-white text-zinc-600")
              }
            >
              {t.label}
              <span
                className={
                  "rounded-full px-1.5 text-[11px] font-bold tabular-nums " +
                  (active ? "bg-[var(--color-brand-600)] text-white" : "bg-zinc-100 text-zinc-500")
                }
              >
                {summary[t.key].count}
              </span>
            </button>
          );
        })}
        <button
          role="tab"
          aria-selected={tab === "diff"}
          type="button"
          onClick={() => setTab("diff")}
          className={
            "inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-full border px-3 text-sm font-medium transition-colors " +
            (tab === "diff"
              ? "border-orange-300 bg-orange-50 text-orange-700"
              : "border-zinc-200 bg-white text-zinc-600")
          }
        >
          มีผลต่าง
          <span
            className={
              "rounded-full px-1.5 text-[11px] font-bold tabular-nums " +
              (tab === "diff" ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-500")
            }
          >
            {diffRows.length}
          </span>
        </button>
      </div>

      {/* DESKTOP/tablet: แถบสรุปแบบ segmented — bucket เป็นช่องกรองในแถบเดียว
          (impeccable critique 2026-06-10: เลิก 5 การ์ด hero-metric เหมือนกันเป๊ะ →
          แถบเดียว เส้นคั่นบาง, count เด่นแต่ไม่ลอย + ยอดกำกับ inline, คลิกกรองได้
          เหมือนเดิม. active = แถบบนสี + พื้นจาง). */}
      <div
        role="tablist"
        aria-label="กลุ่มสถานะการจ่าย"
        className="mb-4 hidden overflow-hidden rounded-xl border border-zinc-200 bg-white sm:flex"
      >
        {TABS.map((t, i) => {
          const active = tab === t.key;
          const s = summary[t.key];
          const tone = TONE[t.key];
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => setTab(t.key)}
              className={
                "flex flex-1 flex-col gap-0.5 border-t-2 px-3 py-2 text-left transition " +
                (i > 0 ? "border-l border-l-zinc-100 " : "") +
                (active ? tone.seg : "border-t-transparent hover:bg-zinc-50")
              }
            >
              <span className="truncate text-[11px] font-medium text-zinc-500">
                {t.label}
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-base font-bold tabular-nums text-zinc-900">
                  {s.count}
                </span>
                <span className={"truncate text-[11px] tabular-nums " + tone.num}>
                  {baht(s.expectedTotal)} ฿
                </span>
              </span>
            </button>
          );
        })}
        {/* ช่องที่ 5 — "มีผลต่าง" (โอนเกิน/ขาด) คำนวณฝั่ง client */}
        {(() => {
          const diffActive = tab === "diff";
          return (
            <button
              role="tab"
              aria-selected={diffActive}
              type="button"
              onClick={() => setTab("diff")}
              className={
                "flex flex-1 flex-col gap-0.5 border-l border-l-zinc-100 border-t-2 px-3 py-2 text-left transition " +
                (diffActive
                  ? "border-t-orange-400 bg-orange-50"
                  : "border-t-transparent hover:bg-zinc-50")
              }
            >
              <span className="truncate text-[11px] font-medium text-zinc-500">
                มีผลต่าง
              </span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-base font-bold tabular-nums text-zinc-900">
                  {diffRows.length}
                </span>
                <span
                  className={
                    "truncate text-[11px] tabular-nums " +
                    (diffNet >= 0 ? "text-amber-600" : "text-rose-600")
                  }
                >
                  {diffNet >= 0 ? "เกิน " : "ขาด "}
                  {baht(Math.abs(diffNet))} ฿
                </span>
              </span>
            </button>
          );
        })()}
      </div>

      {tab !== "abnormal" && (
        <div className="mb-3 flex items-center justify-end gap-2">
          <label htmlFor="reconcile-sort" className="text-xs text-zinc-500">
            เรียง
          </label>
          <select
            id="reconcile-sort"
            value={sort}
            onChange={(e) =>
              setSort(e.target.value as "recent" | "amount-desc" | "amount-asc")
            }
            className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
          >
            <option value="recent">ล่าสุด</option>
            <option value="amount-desc">ยอดมาก → น้อย</option>
            <option value="amount-asc">ยอดน้อย → มาก</option>
          </select>
        </div>
      )}

      {tab === "awaiting" && (
        <RequestList rows={applySort(awaiting)} canCancel={canMatch} emptyHint="ไม่มีคำขอที่รอโอน — เคลียร์หมดแล้ว 🎉" />
      )}
      {tab === "partial" && (
        <RequestList rows={applySort(partial)} canCancel={canMatch} emptyHint="ไม่มีคำขอที่จ่ายบางส่วน" />
      )}
      {tab === "paid" && (
        <RequestList rows={applySort(paid)} canCancel={canMatch} emptyHint="ยังไม่มีคำขอที่จ่ายแล้วใน 90 วันล่าสุด" />
      )}
      {tab === "abnormal" && (
        <div className="space-y-4">
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              คำขอที่ผิดปกติ
            </h3>
            <RequestList rows={abnormal} canCancel={canMatch} emptyHint="ไม่มีคำขอที่ต้องตรวจ" />
          </div>
          <div>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              สลิปลอย (รอจับคู่กับคำขอ)
            </h3>
            {floatingSlips.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500">
                ไม่มีสลิปลอย
              </div>
            ) : (
              <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {floatingSlips.map((s) => (
                  <FloatingSlipCard
                    key={s.id}
                    slip={s}
                    openRequests={openTargets}
                    canMatch={canMatch}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      {tab === "diff" && (
        <div className="space-y-2">
          {diffRows.length > 0 && (
            <p className="rounded-xl bg-orange-50 px-3 py-2 text-xs text-orange-700">
              ใบที่มีสลิปแล้วแต่ยอดโอน <b>ไม่ตรง</b> กับยอดที่ขอ — กดแต่ละใบเพื่อดู
              ยอดต้องโอน · ยอดในสลิป · ผลต่าง (โอนเกิน/ขาด)
            </p>
          )}
          <RequestList
            rows={applySort(diffRows)}
            canCancel={canMatch}
            emptyHint="ไม่มีใบที่โอนเกิน/ขาด — ทุกใบที่จ่ายแล้วยอดตรงพอดี 🎉"
          />
        </div>
      )}
    </div>
  );
}
