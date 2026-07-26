"use client";

// ReconcileBoard — worklist บัญชี "รอโอน · จ่ายบางส่วน · จ่ายแล้ว · ต้องตรวจ" แบบ
// แบ่งซ้าย/ขวา (master-detail) ตามที่ CEO สั่ง: เดิมแต่ละแถวมีแค่ "เลข EXP + ยอด" →
// ไม่รู้ว่าบิลไหนคืออะไร จะแมชยังไง. รอบนี้:
//   • ซ้าย = ลิสต์ (คำขอ หรือ สลิปลอย) กดเลือก · คีย์ลัด ↑/↓
//   • ขวา = รายละเอียด "เทียบ บิล ↔ สลิป คู่กัน" (รูปใบเสร็จ+รายการ vs รูปสลิปที่โอนจริง)
//     → ดูก่อนแมช/ก่อนยืนยันได้จริง
//   • มือถือ = แตะแถว → รายละเอียดเต็มจอ + ปุ่มกลับ
// Read-only ยกเว้น mutation เดิม 3 ตัว (คงตรรกะเป๊ะ ไม่แตะ): assignSlipToRequestAction
// (จับคู่สลิปลอย→คำขอ), cancelPaymentRequestAction (ยกเลิก), resendPaymentRequestAction
// (ส่งการ์ดขอโอนซ้ำ). แต่ละ mutation ยังเรียก server action ตัวเดิม gate เดิมทุกอย่าง.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Ban,
  Banknote,
  Check,
  ChevronRight,
  ExternalLink,
  ImageOff,
  Link2,
  Loader2,
  ReceiptText,
  Send,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BillDetailPane } from "@/components/ledger/BillDetailPane";
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

const TONE: Record<BucketKey, { num: string; seg: string }> = {
  awaiting: { num: "text-amber-600", seg: "border-t-amber-400 bg-amber-50" },
  partial: { num: "text-blue-600", seg: "border-t-blue-400 bg-blue-50" },
  paid: { num: "text-emerald-600", seg: "border-t-emerald-400 bg-emerald-50" },
  abnormal: { num: "text-rose-600", seg: "border-t-rose-400 bg-rose-50" },
};

// ผลต่างโอนเกิน/ขาด (paidTotal − expectedTransfer) เมื่อมีสลิปแล้ว, ไม่งั้น null.
function reqDiff(req: ReconcileRequestRow): number | null {
  if (req.paidTotal > 0 && Math.abs(req.paidTotal - req.expectedTransfer) > 0.01) {
    return req.paidTotal - req.expectedTransfer;
  }
  return null;
}

// ── รูปสลิป (คลิกเปิดเต็มในแท็บใหม่) ──
function SlipImage({
  url,
  thumbUrl,
  alt = "สลิปโอนเงิน",
}: {
  url: string | null;
  thumbUrl: string | null;
  alt?: string;
}) {
  const src = url || thumbUrl;
  if (!src) {
    return (
      <div className="grid h-40 place-items-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50 text-zinc-300">
        <div className="flex flex-col items-center gap-1 text-xs text-zinc-400">
          <ImageOff className="size-5" /> ยังไม่มีสลิป
        </div>
      </div>
    );
  }
  return (
    <a
      href={url || src}
      target="_blank"
      rel="noopener noreferrer"
      className="group relative block overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="mx-auto max-h-[300px] w-auto max-w-full object-contain sm:max-h-[380px]" />
      <span className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white opacity-90">
        <ExternalLink className="size-3" /> เปิดเต็ม
      </span>
    </a>
  );
}

// ── รายละเอียดคำขอ (เทียบ บิล ↔ สลิป) + ปุ่ม cancel/resend เดิม ──
function RequestDetail({
  req,
  canCancel,
  companyId,
  onBack,
}: {
  req: ReconcileRequestRow;
  canCancel: boolean;
  companyId: string;
  onBack: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [resent, setResent] = useState(false);
  const [billIdx, setBillIdx] = useState(0);
  const cancellable = ["open", "partial", "abnormal"].includes(req.state);
  const resendable = ["open", "partial"].includes(req.state);
  const diff = reqDiff(req);
  const bill = req.bills[billIdx] ?? req.bills[0];
  // parent ใส่ key={req.id} → เปลี่ยนคำขอ = remount รีเซ็ต billIdx เอง (เลี่ยง setState-in-effect)

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
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm font-medium text-zinc-600 lg:hidden"
      >
        <ArrowLeft className="size-4" /> กลับไปรายการ
      </button>

      {/* หัว */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-zinc-900">{req.vendor || "ไม่ระบุผู้ขาย"}</span>
            <StatePill state={req.state} />
          </div>
          <p className="mt-0.5 text-xs text-zinc-400">
            {req.bills.length} ใบ
            {req.whtTotal > 0 ? ` · หัก ณ ที่จ่าย ${baht(req.whtTotal)}` : ""}
            {req.paidAt ? ` · จ่าย ${req.paidAt.slice(0, 10)}` : ""}
          </p>
          {req.abnormalReason && (
            <p className="mt-0.5 text-xs text-rose-600">⚠ {req.abnormalReason}</p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xl font-bold tabular-nums text-zinc-900">{baht(req.expectedTransfer)}</div>
          <div className="text-[11px] text-zinc-400">ยอดที่ต้องโอน</div>
        </div>
      </div>

      {/* แถบผลต่าง โอนเกิน/ขาด */}
      {diff != null && (
        <div
          className={
            "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold " +
            (diff > 0 ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700")
          }
        >
          <span>{diff > 0 ? "โอนเกิน" : "โอนขาด"}</span>
          <span className="tabular-nums">฿{baht(Math.abs(diff))}</span>
        </div>
      )}

      {/* เทียบ บิล ↔ สลิป */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* บิล (ที่ต้องจ่าย) */}
        <div>
          <div className="mb-1.5 text-[11px] font-semibold text-zinc-500">บิล (ที่ต้องจ่าย)</div>
          {req.bills.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-6 text-center text-xs text-zinc-400">
              ไม่มีบิลในคำขอนี้แล้ว
            </div>
          ) : (
            <>
              {req.bills.length > 1 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {req.bills.map((b, i) => (
                    <button
                      key={b.expenseId}
                      type="button"
                      onClick={() => setBillIdx(i)}
                      className={
                        "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition-colors " +
                        (i === billIdx
                          ? "border-[var(--color-brand-300,#93C5FD)] bg-[var(--color-brand-50,#EFF6FF)] text-[var(--color-brand-700,#1D4ED8)]"
                          : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50")
                      }
                    >
                      <span className="font-mono">{b.docCode}</span>
                      <span className="tabular-nums text-zinc-400">฿{baht(b.amount)}</span>
                    </button>
                  ))}
                </div>
              )}
              {bill && (
                <BillDetailPane key={bill.expenseId} expenseId={bill.expenseId} companyId={companyId} />
              )}
            </>
          )}
        </div>

        {/* สลิป (ที่โอนจริง) */}
        <div>
          <div className="mb-1.5 text-[11px] font-semibold text-zinc-500">สลิป (ที่โอนจริง)</div>
          <SlipImage url={req.slipUrl} thumbUrl={req.slipThumbUrl} />
          <div className="mt-2 space-y-1 rounded-lg bg-zinc-50 px-3 py-2 text-xs ring-1 ring-inset ring-zinc-100">
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">ยอดในสลิป</span>
              <span className="tabular-nums font-medium text-zinc-800">
                {req.paidTotal > 0 ? `฿${baht(req.paidTotal)}` : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-zinc-500">รวมก่อนหัก</span>
              <span className="tabular-nums text-zinc-600">฿{baht(req.billsGross)}</span>
            </div>
            {req.transRef && (
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">อ้างอิง</span>
                <span className="font-mono text-zinc-600">{req.transRef}</span>
              </div>
            )}
            {req.requestedByName && (
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">ผู้ขอ</span>
                <span className="text-zinc-600">{req.requestedByName}</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* actions เดิม (คงตรรกะ) */}
      {canCancel && cancellable && (
        <div className="border-t border-zinc-100 pt-2">
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
                  {resent ? <Check className="size-3.5" aria-hidden /> : <Send className="size-3.5" aria-hidden />}
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
    </div>
  );
}

// ── รายละเอียดสลิปลอย (เทียบสลิป ↔ บิลของคำขอที่จะจับคู่) + ปุ่มจับคู่เดิม ──
function FloatingSlipDetail({
  slip,
  openRequests,
  canMatch,
  companyId,
  onBack,
}: {
  slip: ReconcileFloatingSlip;
  openRequests: ReconcileRequestRow[];
  canMatch: boolean;
  companyId: string;
  onBack: () => void;
}) {
  // แนะนำคำขอที่ยอดตรงกับสลิปก่อน (ช่วยเลือกใบที่ถูก)
  const sorted = useMemo(() => {
    const near = openRequests.filter((r) => Math.abs(r.expectedTransfer - slip.amount) < 0.005);
    const rest = openRequests.filter((r) => Math.abs(r.expectedTransfer - slip.amount) >= 0.005);
    return [...near, ...rest];
  }, [openRequests, slip.amount]);

  const router = useRouter();
  const [requestId, setRequestId] = useState(sorted[0]?.id ?? "");
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const candidate = openRequests.find((r) => r.id === requestId) ?? null;
  const candBill = candidate?.bills[0] ?? null;
  const amountMatch = candidate ? Math.abs(candidate.expectedTransfer - slip.amount) < 0.005 : false;

  function assign() {
    if (!requestId) return;
    setErr(null);
    start(async () => {
      const res = await assignSlipToRequestAction(slip.id, requestId);
      if (res.ok) {
        setDone(true);
        router.refresh();
      } else setErr(res.error ?? "จับคู่ไม่สำเร็จ");
    });
  }

  if (done) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
        ✅ จับคู่สลิป {baht(slip.amount)} บาท กับคำขอโอนเรียบร้อย
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm font-medium text-zinc-600 lg:hidden"
      >
        <ArrowLeft className="size-4" /> กลับไปรายการ
      </button>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-base font-semibold text-zinc-900">
            <Banknote className="size-4 text-emerald-600" aria-hidden />
            {baht(slip.amount)} บาท
          </p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {slip.sendingBank ? `ธนาคาร ${slip.sendingBank} · ` : ""}
            {slip.transRef ? `อ้างอิง ${slip.transRef}` : slip.qrDecoded ? "อ่าน QR แล้ว" : "ไม่มี QR (อ่านยอดด้วย AI)"}
          </p>
          <p className="mt-0.5 text-[11px] text-rose-500">สลิปลอย — ยังไม่ผูกกับคำขอโอน</p>
        </div>
      </div>

      {/* เทียบสลิป ↔ บิลของคำขอที่จะจับคู่ */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[11px] font-semibold text-zinc-500">สลิปที่ได้รับ</div>
          <SlipImage url={slip.slipUrl} thumbUrl={slip.slipThumbUrl} />
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-semibold text-zinc-500">บิลของคำขอที่จะจับคู่</div>
          {candBill ? (
            <BillDetailPane key={candBill.expenseId} expenseId={candBill.expenseId} companyId={companyId} />
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-6 text-center text-xs text-zinc-400">
              {candidate ? "คำขอนี้ไม่มีบิลแนบ" : "เลือกคำขอด้านล่างเพื่อเทียบ"}
            </div>
          )}
        </div>
      </div>

      {/* เลือกคำขอ + ปุ่มจับคู่ (คงตรรกะเดิม) */}
      {canMatch ? (
        <div className="space-y-2 border-t border-zinc-100 pt-3">
          <label className="text-[11px] font-medium text-zinc-500">จับคู่กับคำขอโอน</label>
          <div className="flex flex-wrap items-center gap-2">
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
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
              จับคู่กับคำขอ
            </button>
          </div>
          {candidate && (
            <p className={"text-xs " + (amountMatch ? "text-emerald-600" : "text-amber-600")}>
              {amountMatch
                ? "✓ ยอดสลิปตรงกับยอดคำขอ"
                : `⚠ ยอดต่างกัน ฿${baht(Math.abs((candidate?.expectedTransfer ?? 0) - slip.amount))} — ตรวจก่อนจับคู่`}
            </p>
          )}
          {err && <p className="text-xs text-rose-600">{err}</p>}
        </div>
      ) : (
        <p className="border-t border-zinc-100 pt-3 text-xs text-zinc-400">เฉพาะบัญชี/ผู้ดูแลจับคู่สลิปได้</p>
      )}
    </div>
  );
}

// ── แถวลิสต์ (คำขอ) ──
function RequestListItem({
  req,
  active,
  onSelect,
  itemRef,
}: {
  req: ReconcileRequestRow;
  active: boolean;
  onSelect: () => void;
  itemRef: (el: HTMLButtonElement | null) => void;
}) {
  const diff = reqDiff(req);
  return (
    <button
      ref={itemRef}
      type="button"
      onClick={onSelect}
      aria-current={active}
      className={
        "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors " +
        (active
          ? "border-[var(--color-brand-300,#93C5FD)] bg-[var(--color-brand-50,#EFF6FF)] ring-1 ring-[var(--color-brand-200,#BFDBFE)]"
          : "border-zinc-200 bg-white hover:bg-zinc-50")
      }
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-zinc-900">{req.vendor || "ไม่ระบุผู้ขาย"}</span>
          <StatePill state={req.state} />
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400">
          <span>{req.bills.length} ใบ</span>
          {req.slipUrl && (
            <span className="inline-flex items-center gap-0.5">
              <ReceiptText className="size-3" /> มีสลิป
            </span>
          )}
          {diff != null && (
            <span className={"rounded-full px-1.5 py-0.5 font-medium " + (diff > 0 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700")}>
              {diff > 0 ? "เกิน" : "ขาด"} {baht(Math.abs(diff))}
            </span>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-sm font-bold tabular-nums text-zinc-900">{baht(req.expectedTransfer)}</div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-zinc-300 lg:hidden" />
    </button>
  );
}

// ── แถวลิสต์ (สลิปลอย) ──
function SlipListItem({
  slip,
  active,
  onSelect,
  itemRef,
}: {
  slip: ReconcileFloatingSlip;
  active: boolean;
  onSelect: () => void;
  itemRef: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={itemRef}
      type="button"
      onClick={onSelect}
      aria-current={active}
      className={
        "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors " +
        (active
          ? "border-rose-300 bg-rose-50 ring-1 ring-rose-200"
          : "border-rose-200 bg-rose-50/40 hover:bg-rose-50")
      }
    >
      {slip.slipThumbUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={slip.slipThumbUrl} alt="สลิป" className="size-10 shrink-0 rounded-lg border border-zinc-200 object-cover" />
      ) : (
        <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-zinc-200 bg-white text-zinc-300">
          <ImageOff className="size-4" aria-hidden />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-800">
          <Banknote className="size-3.5 text-emerald-600" aria-hidden />
          {baht(slip.amount)} บาท
        </div>
        <div className="mt-0.5 truncate text-[11px] text-zinc-400">
          {slip.sendingBank ? `${slip.sendingBank} · ` : ""}
          {slip.transRef ? slip.transRef : slip.qrDecoded ? "อ่าน QR แล้ว" : "อ่านด้วย AI"}
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-zinc-300 lg:hidden" />
    </button>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-10 text-center text-sm text-zinc-500 lg:min-h-[240px] lg:content-center">
      {text}
    </div>
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
  companyId,
}: {
  awaiting: ReconcileRequestRow[];
  partial: ReconcileRequestRow[];
  paid: ReconcileRequestRow[];
  abnormal: ReconcileRequestRow[];
  floatingSlips: ReconcileFloatingSlip[];
  summary: Record<BucketKey, { count: number; expectedTotal: number }>;
  canMatch: boolean;
  companyId: string;
}) {
  const [tab, setTab] = useState<BucketKey | "diff">("awaiting");
  const [sort, setSort] = useState<"recent" | "amount-desc" | "amount-asc">("recent");
  // default = ใบแรกของ "รอโอน" (desktop เห็นรายละเอียดพร้อมใช้)
  const [selId, setSelId] = useState<string | null>(awaiting[0]?.id ?? null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const detailRef = useRef<HTMLDivElement>(null);

  // คำขอที่เปิดอยู่ = เป้าหมายจับคู่สลิปลอย (ต้องมีบิลไว้เทียบ → ส่ง full row)
  const openTargets = useMemo(() => [...awaiting, ...partial], [awaiting, partial]);

  // "มีผลต่าง" — ใบมีสลิปแล้วแต่ยอดโอนไม่ตรง (derive ฝั่ง client เหมือนเดิม)
  const diffRows = useMemo(() => {
    const all = [...partial, ...paid, ...abnormal];
    const seen = new Set<string>();
    return all
      .filter((r) => {
        if (seen.has(r.id)) return false;
        seen.add(r.id);
        return r.paidTotal > 0 && Math.abs(r.paidTotal - r.expectedTransfer) > 0.01;
      })
      .sort((a, b) => Math.abs(b.paidTotal - b.expectedTransfer) - Math.abs(a.paidTotal - a.expectedTransfer));
  }, [partial, paid, abnormal]);
  const diffNet = useMemo(
    () => diffRows.reduce((s, r) => s + (r.paidTotal - r.expectedTransfer), 0),
    [diffRows],
  );

  const applySort = (rows: ReconcileRequestRow[]) => {
    if (sort === "amount-desc") return [...rows].sort((a, b) => b.expectedTransfer - a.expectedTransfer);
    if (sort === "amount-asc") return [...rows].sort((a, b) => a.expectedTransfer - b.expectedTransfer);
    return rows;
  };

  // รายการฝั่งซ้ายของแท็บปัจจุบัน (memoize เพื่อ navIds ไม่เปลี่ยนทุก render)
  const listRequests: ReconcileRequestRow[] = useMemo(() => {
    if (tab === "awaiting") return applySort(awaiting);
    if (tab === "partial") return applySort(partial);
    if (tab === "paid") return applySort(paid);
    if (tab === "abnormal") return abnormal;
    return applySort(diffRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sort, awaiting, partial, paid, abnormal, diffRows]);
  const listSlips: ReconcileFloatingSlip[] = useMemo(
    () => (tab === "abnormal" ? floatingSlips : []),
    [tab, floatingSlips],
  );
  const navIds = useMemo(
    () => [...listRequests.map((r) => r.id), ...listSlips.map((s) => "slip:" + s.id)],
    [listRequests, listSlips],
  );

  // เปลี่ยนแท็บ → เลือกตัวแรกของแท็บ + ปิดมุมมองมือถือ (ทำใน handler ไม่ใช่ effect →
  // เลี่ยง setState-in-effect / cascading render).
  function changeTab(next: BucketKey | "diff") {
    setTab(next);
    setMobileDetail(false);
    const rows =
      next === "awaiting" ? applySort(awaiting)
      : next === "partial" ? applySort(partial)
      : next === "paid" ? applySort(paid)
      : next === "abnormal" ? abnormal
      : applySort(diffRows);
    const firstReq = rows[0]?.id;
    const firstSlip = next === "abnormal" ? floatingSlips[0]?.id : undefined;
    setSelId(firstReq ?? (firstSlip ? "slip:" + firstSlip : null));
  }

  useEffect(() => {
    if (selId) rowRefs.current.get(selId)?.scrollIntoView({ block: "nearest" });
  }, [selId]);

  const selReq = selId && !selId.startsWith("slip:") ? listRequests.find((r) => r.id === selId) ?? [...awaiting, ...partial, ...paid, ...abnormal, ...diffRows].find((r) => r.id === selId) ?? null : null;
  const selSlip = selId && selId.startsWith("slip:") ? floatingSlips.find((s) => "slip:" + s.id === selId) ?? null : null;

  function selectItem(id: string) {
    setSelId(id);
    setMobileDetail(true);
  }
  function move(delta: number) {
    if (navIds.length === 0) return;
    const idx = navIds.indexOf(selId ?? "");
    const ni = ((idx < 0 ? 0 : idx) + delta + navIds.length) % navIds.length;
    setSelId(navIds[ni]);
    rowRefs.current.get(navIds[ni])?.focus();
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if ((e.key === "Enter" || e.key === " " || e.key === "v" || e.key === "V") && selReq) {
      e.preventDefault();
      // เปิดรูปบิลเต็มจอ = คลิกปุ่มขยายในแผงรายละเอียด (DOM action · ไม่ใช้ signal/effect)
      detailRef.current?.querySelector<HTMLButtonElement>("[data-bill-zoom]")?.click();
    }
  }

  const registerRef = (id: string) => (el: HTMLButtonElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  };

  return (
    <div onKeyDown={onKeyDown}>
      {/* MOBILE: pill-rail buckets */}
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
              onClick={() => changeTab(t.key)}
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
          onClick={() => changeTab("diff")}
          className={
            "inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-full border px-3 text-sm font-medium transition-colors " +
            (tab === "diff" ? "border-orange-300 bg-orange-50 text-orange-700" : "border-zinc-200 bg-white text-zinc-600")
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

      {/* DESKTOP: segmented summary */}
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
              onClick={() => changeTab(t.key)}
              className={
                "flex flex-1 flex-col gap-0.5 border-t-2 px-3 py-2 text-left transition " +
                (i > 0 ? "border-l border-l-zinc-100 " : "") +
                (active ? tone.seg : "border-t-transparent hover:bg-zinc-50")
              }
            >
              <span className="truncate text-[11px] font-medium text-zinc-500">{t.label}</span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-base font-bold tabular-nums text-zinc-900">{s.count}</span>
                <span className={"truncate text-[11px] tabular-nums " + tone.num}>{baht(s.expectedTotal)} ฿</span>
              </span>
            </button>
          );
        })}
        {(() => {
          const diffActive = tab === "diff";
          return (
            <button
              role="tab"
              aria-selected={diffActive}
              type="button"
              onClick={() => changeTab("diff")}
              className={
                "flex flex-1 flex-col gap-0.5 border-l border-l-zinc-100 border-t-2 px-3 py-2 text-left transition " +
                (diffActive ? "border-t-orange-400 bg-orange-50" : "border-t-transparent hover:bg-zinc-50")
              }
            >
              <span className="truncate text-[11px] font-medium text-zinc-500">มีผลต่าง</span>
              <span className="flex items-baseline gap-1.5">
                <span className="text-base font-bold tabular-nums text-zinc-900">{diffRows.length}</span>
                <span className={"truncate text-[11px] tabular-nums " + (diffNet >= 0 ? "text-amber-600" : "text-rose-600")}>
                  {diffNet >= 0 ? "เกิน " : "ขาด "}
                  {baht(Math.abs(diffNet))} ฿
                </span>
              </span>
            </button>
          );
        })()}
      </div>

      {/* master-detail */}
      <div className="lg:grid lg:grid-cols-[minmax(300px,400px)_1fr] lg:gap-4">
        {/* ซ้าย: ลิสต์ */}
        <div className={(mobileDetail ? "hidden" : "block") + " lg:block"}>
          {tab !== "abnormal" && (
            <div className="mb-2 flex items-center justify-end gap-2">
              <label htmlFor="reconcile-sort" className="text-xs text-zinc-500">เรียง</label>
              <select
                id="reconcile-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as "recent" | "amount-desc" | "amount-asc")}
                className="h-8 rounded-lg border border-zinc-200 bg-white px-2 text-xs outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
              >
                <option value="recent">ล่าสุด</option>
                <option value="amount-desc">ยอดมาก → น้อย</option>
                <option value="amount-asc">ยอดน้อย → มาก</option>
              </select>
            </div>
          )}

          {tab === "diff" && diffRows.length > 0 && (
            <p className="mb-2 rounded-xl bg-orange-50 px-3 py-2 text-xs text-orange-700">
              ใบที่มีสลิปแล้วแต่ยอดโอน <b>ไม่ตรง</b> — กดดูเทียบยอดต้องโอน · ยอดในสลิป · ผลต่าง
            </p>
          )}

          {navIds.length === 0 ? (
            <EmptyHint
              text={
                tab === "awaiting" ? "ไม่มีคำขอที่รอโอน — เคลียร์หมดแล้ว 🎉"
                : tab === "partial" ? "ไม่มีคำขอที่จ่ายบางส่วน"
                : tab === "paid" ? "ยังไม่มีคำขอที่จ่ายแล้วใน 90 วันล่าสุด"
                : tab === "abnormal" ? "ไม่มีคำขอ/สลิปที่ต้องตรวจ 🎉"
                : "ไม่มีใบที่โอนเกิน/ขาด — ทุกใบยอดตรงพอดี 🎉"
              }
            />
          ) : (
            <div className="space-y-3">
              {listRequests.length > 0 && (
                <ul className="space-y-1.5">
                  {tab === "abnormal" && (
                    <li className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">คำขอที่ผิดปกติ</li>
                  )}
                  {listRequests.map((r) => (
                    <li key={r.id}>
                      <RequestListItem req={r} active={selId === r.id} onSelect={() => selectItem(r.id)} itemRef={registerRef(r.id)} />
                    </li>
                  ))}
                </ul>
              )}
              {listSlips.length > 0 && (
                <ul className="space-y-1.5">
                  <li className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">สลิปลอย (รอจับคู่กับคำขอ)</li>
                  {listSlips.map((s) => {
                    const sid = "slip:" + s.id;
                    return (
                      <li key={s.id}>
                        <SlipListItem slip={s} active={selId === sid} onSelect={() => selectItem(sid)} itemRef={registerRef(sid)} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          <p className="mt-2 hidden px-1 text-[11px] text-zinc-400 lg:block">
            คีย์ลัด: ↑/↓ เลื่อน · Enter เปิดรูปบิล
          </p>
        </div>

        {/* ขวา: รายละเอียด */}
        <div ref={detailRef} className={(mobileDetail ? "block" : "hidden") + " lg:block"}>
          {selReq ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-3 sm:p-4">
              <RequestDetail
                key={selReq.id}
                req={selReq}
                canCancel={canMatch}
                companyId={companyId}
                onBack={() => setMobileDetail(false)}
              />
            </div>
          ) : selSlip ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-3 sm:p-4">
              <FloatingSlipDetail
                key={selSlip.id}
                slip={selSlip}
                openRequests={openTargets}
                canMatch={canMatch}
                companyId={companyId}
                onBack={() => setMobileDetail(false)}
              />
            </div>
          ) : (
            <div className="hidden rounded-xl border border-dashed border-zinc-200 py-16 text-center text-sm text-zinc-400 lg:block">
              เลือกรายการจากด้านซ้ายเพื่อดูรายละเอียด · เทียบบิลกับสลิป
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
