"use client";

// Slip viewer — click a deposit amount or the "สลิป" badge in the reconcile
// ledger to pop the deposit slip image up full-screen (CEO 2026-06-03).
// Non-modal-feel lightbox: dark overlay, click-outside / Esc / X to close.
// The ledger table itself is a server component, so these are the small
// client islands it embeds for the two interactive cells.

import { Paperclip, X, History, Trash2, Check, Ban } from "lucide-react";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useEffect, useState } from "react";
import { toast } from "sonner";
import { clearDepositReview } from "@/app/(admin)/chairops/(office)/review-queue/actions";
import {
  attachDepositSlip,
  approveSlipAttachment,
  requestDeleteSlipAttachment,
  approveDeleteSlipAttachment,
  rejectDeleteSlipAttachment,
} from "@/app/(admin)/chairops/reconcile/actions";
import type { PeriodSlip } from "@/lib/chairops/queries/reconcile-v2";

// Single source of truth for the attachment shape — imported from the query
// layer instead of redeclared, so approve/delete fields can never drift
// between the two (see [[feedback-one-rule-two-copies-drifts-2026-09-23]]).
type SlipAttachment = PeriodSlip["additionalSlips"][number];

function isImageUrl(u: string | null | undefined): u is string {
  return !!u && /^https?:\/\//i.test(u);
}

function Lightbox({
  url,
  caption,
  onClose,
  footer,
}: {
  url: string;
  caption: string;
  onClose: () => void;
  /** CEO 2026-09-22: confirm-reviewed button for flagged slips — shown right
   *  where office is already looking at the slip, instead of only on the
   *  separate /chairops/review-queue page. */
  footer?: React.ReactNode;
}) {
  // Esc closes — keyboard parity with click-outside.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="ดูสลิปฝากเงินเต็มจอ"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur hover:bg-white/20"
        aria-label="ปิด"
      >
        <X className="size-5" aria-hidden="true" />
      </button>
      <div
        className="relative max-h-[90vh] max-w-[95vw]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* unoptimized: R2 URLs aren't in next/image remotePatterns */}
        <Image
          src={url}
          alt={caption}
          width={1400}
          height={1900}
          className="max-h-[90vh] w-auto rounded-lg object-contain"
          unoptimized
        />
        <div className="absolute inset-x-2 bottom-2 flex flex-col items-center gap-2 rounded bg-black/60 px-2 py-2">
          <span className="text-center font-mono text-xs text-white">
            {caption}
          </span>
          {footer}
        </div>
      </div>
    </div>
  );
}

/** ปุ่มยืนยัน "ตรวจแล้ว ปกติ" บนสลิปที่ติดธง — กดตรงนี้แทนต้องไปหน้า
 *  /chairops/review-queue แยก (CEO 2026-09-22). `returnTo` = หน้าปัจจุบัน
 *  ให้ redirect กลับมาที่เดิมหลังเคลียร์ธง ไม่ใช่เด้งไป review-queue เสมอ. */
function ConfirmReviewedForm({ depositId }: { depositId: string }) {
  const pathname = usePathname();
  return (
    <form
      action={clearDepositReview}
      onClick={(e) => e.stopPropagation()}
      className="flex flex-col items-center gap-1"
    >
      <input type="hidden" name="depositId" value={depositId} />
      <input type="hidden" name="returnTo" value={pathname} />
      <button
        type="submit"
        className="inline-flex items-center gap-1 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600"
      >
        ✓ ตรวจแล้ว ปกติ
      </button>
    </form>
  );
}

/** ปุ่มเล็ก ๆ ใต้รูปสลิปเสริม — ใช้ style เดียวกันทุกปุ่มให้แถวไม่ล้น. */
function MiniButton({
  onClick,
  disabled,
  tone,
  children,
  title,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone: "neutral" | "emerald" | "rose" | "amber";
  children: React.ReactNode;
  title?: string;
}) {
  const toneClass = {
    neutral: "bg-white/15 hover:bg-white/25 text-white",
    emerald: "bg-emerald-500 hover:bg-emerald-600 text-white",
    rose: "bg-rose-500 hover:bg-rose-600 text-white",
    amber: "bg-amber-500/90 hover:bg-amber-500 text-black",
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold disabled:opacity-50 ${toneClass}`}
    >
      {children}
    </button>
  );
}

/** ใส่เหตุผลสั้น ๆ ก่อนส่ง — ใช้ทั้งตอน "ขอลบ" และตอน "ปฏิเสธคำขอลบ" (CEO 2026-09-25). */
function InlineReasonPrompt({
  placeholder,
  submitLabel,
  submitTone,
  onCancel,
  onSubmit,
}: {
  placeholder: string;
  submitLabel: string;
  submitTone: "rose" | "emerald";
  onCancel: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex w-full flex-col gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={placeholder}
        maxLength={500}
        className="w-full rounded border border-white/20 bg-black/40 px-2 py-1 text-[11px] text-white placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-white/40"
      />
      <div className="flex gap-1">
        <MiniButton
          tone={submitTone}
          disabled={busy || reason.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit(reason.trim());
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "กำลังส่ง..." : submitLabel}
        </MiniButton>
        <MiniButton tone="neutral" disabled={busy} onClick={onCancel}>
          ยกเลิก
        </MiniButton>
      </div>
    </div>
  );
}

/** ประวัติของสลิปใบนี้ — แนบเมื่อไร/ใคร · อนุมัติเมื่อไร/ใคร · ขอลบ+เหตุผล ·
 *  ผลตัดสินคำขอลบ. เปิดจากปุ่มไอคอนนาฬิกา (CEO 2026-09-25: "กดดูให้ขึ้นตรงนั้นเลย"
 *  — ไม่เปิดหน้าใหม่). */
function SlipHistoryPanel({ slip }: { slip: SlipAttachment }) {
  return (
    <div className="w-full rounded bg-black/40 p-2 text-left text-[10px] leading-relaxed text-white/85">
      <div>📎 แนบโดย {slip.uploadedByName ?? "—"} · {slip.uploadedAt}</div>
      {slip.approvedAt && (
        <div>✓ อนุมัติโดย {slip.approvedByName ?? "—"} · {slip.approvedAt}</div>
      )}
      {slip.deleteRequestedAt && (
        <div>
          🗑️ ขอลบโดย {slip.deleteRequestedByName ?? "—"} · {slip.deleteRequestedAt}
          {slip.deleteReason && <> — เหตุผล: “{slip.deleteReason}”</>}
        </div>
      )}
      {slip.deleteApproverAt && (
        <div>
          {slip.deleteStatus === "APPROVED" ? "✅ อนุมัติลบโดย " : "❌ ปฏิเสธโดย "}
          {slip.deleteApproverByName ?? "—"} · {slip.deleteApproverAt}
          {slip.deleteApproverNote && <> — “{slip.deleteApproverNote}”</>}
        </div>
      )}
      {!slip.approvedAt && !slip.deleteRequestedAt && (
        <div className="text-white/50">ยังไม่มีความเคลื่อนไหวอื่น</div>
      )}
    </div>
  );
}

/** สลิปเสริมที่แนบไว้แล้ว 1 ใบ — ลิงก์ดูรูป + อนุมัติ + ขอลบ (maker/checker) +
 *  ประวัติ (CEO 2026-09-22, ขยาย 2026-09-25). ทุกปุ่มทำงานอยู่ในหน้าเดิม ไม่เด้ง
 *  ไปหน้าอื่น — "กดลบจากช่องตรงนั้นได้เลย" ตามที่ CEO ขอ. */
function SlipAttachmentRow({ slip, index }: { slip: SlipAttachment; index: number }) {
  const router = useRouter();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mode, setMode] = useState<"idle" | "requestDelete" | "reject">("idle");
  const [busy, setBusy] = useState(false);

  // FormData ต้อง append จริง — helper กันพิมพ์ผิดซ้ำ
  function fd(fields: Record<string, string>) {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    return f;
  }

  async function callAction<T>(
    action: (fd: FormData) => Promise<{ ok: true; data: T } | { ok: false; error: string }>,
    fields: Record<string, string>,
    successMessage: string,
  ) {
    setBusy(true);
    try {
      const res = await action(fd(fields));
      if (!res.ok) {
        toast.error(res.error);
      } else {
        toast.success(successMessage);
        setMode("idle");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex w-full flex-col items-start gap-1 rounded-lg bg-white/10 p-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex w-full flex-wrap items-center gap-1">
        <a
          href={slip.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-1 text-[11px] text-white hover:bg-white/25"
          title={slip.note ?? `สลิปเสริม · ${slip.uploadedAt}`}
        >
          <Paperclip size={10} aria-hidden="true" /> สลิปเสริม #{index + 1}
        </a>

        {slip.approvedAt ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/90 px-2 py-1 text-[10px] font-semibold text-white">
            <Check size={10} aria-hidden="true" /> อนุมัติแล้ว
          </span>
        ) : (
          <MiniButton
            tone="emerald"
            disabled={busy}
            title="ยืนยันว่าสลิปนี้ถูกต้อง"
            onClick={() =>
              callAction(approveSlipAttachment, { attachmentId: slip.id }, "อนุมัติสลิปแล้ว")
            }
          >
            <Check size={10} aria-hidden="true" /> อนุมัติ
          </MiniButton>
        )}

        {slip.deleteStatus === "PENDING" ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/90 px-2 py-1 text-[10px] font-semibold text-black">
            ⏳ รออนุมัติลบ
          </span>
        ) : (
          mode === "idle" && (
            <MiniButton
              tone="rose"
              disabled={busy}
              onClick={() => setMode("requestDelete")}
              title="แนบผิดใบ? ขอลบสลิปนี้"
            >
              <Trash2 size={10} aria-hidden="true" /> ขอลบ
            </MiniButton>
          )
        )}

        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          aria-expanded={historyOpen}
          aria-label="ดูประวัติสลิปนี้"
          title="ดูประวัติ"
          className="inline-flex items-center justify-center rounded-full bg-white/10 p-1.5 text-white hover:bg-white/20"
        >
          <History size={11} aria-hidden="true" />
        </button>
      </div>

      {slip.deleteStatus === "PENDING" && mode === "idle" && (
        <div className="flex w-full flex-wrap items-center gap-1">
          <MiniButton
            tone="emerald"
            disabled={busy}
            onClick={() =>
              callAction(approveDeleteSlipAttachment, { attachmentId: slip.id }, "อนุมัติการลบแล้ว")
            }
          >
            ✅ อนุมัติลบ
          </MiniButton>
          <MiniButton tone="rose" disabled={busy} onClick={() => setMode("reject")}>
            <Ban size={10} aria-hidden="true" /> ปฏิเสธ
          </MiniButton>
        </div>
      )}

      {mode === "requestDelete" && (
        <InlineReasonPrompt
          placeholder="เหตุผล เช่น แนบผิดใบ (บังคับ)"
          submitLabel="ส่งคำขอลบ"
          submitTone="rose"
          onCancel={() => setMode("idle")}
          onSubmit={(reason) =>
            callAction(
              requestDeleteSlipAttachment,
              { attachmentId: slip.id, reason },
              "ส่งคำขอลบแล้ว รอผู้จัดการ/CEO อนุมัติ",
            )
          }
        />
      )}

      {mode === "reject" && (
        <InlineReasonPrompt
          placeholder="เหตุผลที่ปฏิเสธ (บังคับ)"
          submitLabel="ยืนยันปฏิเสธ"
          submitTone="emerald"
          onCancel={() => setMode("idle")}
          onSubmit={(reason) =>
            callAction(
              rejectDeleteSlipAttachment,
              { attachmentId: slip.id, reason },
              "ปฏิเสธคำขอลบแล้ว สลิปยังอยู่เหมือนเดิม",
            )
          }
        />
      )}

      {historyOpen && <SlipHistoryPanel slip={slip} />}
    </div>
  );
}

/** สลิปเสริมที่แนบไว้แล้ว — ลิงก์เปิดดูรูป + อนุมัติ/ขอลบต่อใบ (CEO 2026-09-22,
 *  ขยาย 2026-09-25). */
function AdditionalSlipsList({ slips }: { slips: SlipAttachment[] }) {
  if (slips.length === 0) return null;
  return (
    <div
      className="flex w-full flex-col items-stretch gap-1"
      onClick={(e) => e.stopPropagation()}
    >
      {slips.map((s, i) => (
        <SlipAttachmentRow key={s.id} slip={s} index={i} />
      ))}
    </div>
  );
}

/** ปุ่ม "+ แนบสลิปเพิ่ม" — แม่บ้านลืมแนบ ส่งมาทาง LINE ทีหลัง office แนบให้ตรงนี้
 *  ได้เลยทันที ไม่ต้องขออนุมัติ (CEO 2026-09-22). แสดงเสมอไม่ว่าสลิปจะติดธง
 *  หรือไม่ก็ตาม — ต่างจาก ConfirmReviewedForm ที่โชว์เฉพาะตอนติดธง. */
function AttachSlipForm({ depositId }: { depositId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("depositId", depositId);
      const result = await attachDepositSlip(fd);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success("แนบสลิปเพิ่มแล้ว");
        router.refresh();
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <label
      className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/25"
      onClick={(e) => e.stopPropagation()}
    >
      <Paperclip size={12} aria-hidden="true" />
      {uploading ? "กำลังอัปโหลด..." : "+ แนบสลิปเพิ่ม"}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={uploading}
        onChange={handleFile}
      />
    </label>
  );
}

/** "สลิป" column cell — clickable badge when a real slip image exists. */
export function SlipBadge({
  url,
  missing,
  caption,
}: {
  /** Real image URL, the literal "slip" placeholder, or null. */
  url: string | null;
  /** CSV import row that has no slip yet → amber warning. */
  missing: boolean;
  caption: string;
}) {
  const [open, setOpen] = useState(false);

  if (isImageUrl(url)) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rc-slip"
          aria-label="ดูสลิปฝากเงิน"
        >
          <Paperclip size={11} aria-hidden="true" /> สลิป
        </button>
        {open && (
          <Lightbox url={url} caption={caption} onClose={() => setOpen(false)} />
        )}
      </>
    );
  }
  if (missing) {
    return (
      <span
        title="CSV import ยังไม่มี slipUrl"
        className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
      >
        ยังไม่มีสลิป
      </span>
    );
  }
  if (url) {
    // collection exists but no photo attached
    return (
      <span className="text-muted" title="ไม่มีรูปสลิปแนบ">
        สลิป
      </span>
    );
  }
  return <span className="text-muted">—</span>;
}

/** "ฝาก" column cell — the deposit amount; click opens the slip image. */
export function DepositAmount({
  amount,
  slipUrl,
  caption,
}: {
  /** Pre-formatted amount string (e.g. "1,710"). */
  amount: string;
  slipUrl: string | null;
  caption: string;
}) {
  const [open, setOpen] = useState(false);

  if (isImageUrl(slipUrl)) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rc-deposit-link"
          aria-label="ดูสลิปฝากเงิน"
          title="กดเพื่อดูสลิปฝากเงิน"
        >
          {amount}
        </button>
        {open && (
          <Lightbox
            url={slipUrl}
            caption={caption}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    );
  }
  return <>{amount}</>;
}

/** ยอดต่อ "ใบฝาก" หนึ่งใบ ในตาราง Periods (CEO 2026-08-17) — คลิกดูสลิปใบนั้นได้
 *  ตรงในตาราง ไม่ต้องกางลึก. สีบอกสถานะ reconcile: ดำ=ยังไม่ส่ง · ฟ้า=ส่งแล้วรอ
 *  จับคู่ · สีรุ้ง=จับคู่กับ statement ธนาคารแล้ว. กรอบแดง = ติดธงรอตรวจสอบ
 *  (สลิปซ้ำ/บัญชีปลายทางไม่ตรง/ผลต่างเกิน — ดู lib/chairops/reconcile/slip-ocr.ts). */
export function SlipChip({
  amount,
  slipUrl,
  caption,
  status,
  flagged,
  depositId,
  additionalSlips,
}: {
  amount: string;
  slipUrl: string | null;
  caption: string;
  status: "not_sent" | "sent_unmatched" | "sent_matched";
  flagged: boolean;
  /** เมื่อมีค่า → โชว์ปุ่ม "แนบสลิปเพิ่ม" เสมอ + ปุ่ม "ตรวจแล้ว ปกติ" ถ้า flagged. */
  depositId?: string;
  /** สลิปเสริมที่แนบไว้แล้ว (CEO 2026-09-22) — โชว์เป็นลิงก์ใต้รูปหลัก. */
  additionalSlips?: SlipAttachment[];
}) {
  const [open, setOpen] = useState(false);

  const statusClass =
    status === "sent_matched"
      ? "text-matched-iridescent"
      : status === "sent_unmatched"
        ? "rc-slipchip-sent"
        : "rc-slipchip-unsent";

  const chip = (
    <span
      className={`rc-slipchip ${statusClass}${flagged ? " rc-slipchip-flagged" : ""}`}
      title={flagged ? "ติดธง รอตรวจสอบก่อนส่งเข้าบัญชี reconcile" : undefined}
    >
      {flagged ? "⚠ " : ""}
      {amount}
    </span>
  );

  if (!isImageUrl(slipUrl)) return chip;

  const footer = depositId ? (
    <>
      <AdditionalSlipsList slips={additionalSlips ?? []} />
      <div style={{ display: "flex", gap: 6 }}>
        <AttachSlipForm depositId={depositId} />
        {flagged && <ConfirmReviewedForm depositId={depositId} />}
      </div>
    </>
  ) : undefined;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rc-slipchip-btn"
        aria-label="ดูสลิปฝากเงิน"
      >
        {chip}
        {additionalSlips && additionalSlips.length > 0 && (
          <span
            className="rc-slipchip"
            style={{ marginLeft: 2, fontSize: 9, opacity: 0.8 }}
            title={`มีสลิปเสริมอีก ${additionalSlips.length} ใบ`}
          >
            +{additionalSlips.length}
          </span>
        )}
      </button>
      {open && (
        <Lightbox
          url={slipUrl}
          caption={caption}
          onClose={() => setOpen(false)}
          footer={footer}
        />
      )}
    </>
  );
}

/** เมื่อวันเดียวมีหลายสลิป (ฝากหลายรอบ) — CEO 2026-09-22: "รวมยอดสลิปแล้วกดเข้า
 *  ไปดู แล้วเห็นสลิปด้านในแบบนั้นดีกว่า" ก่อนหน้านี้แต่ละสลิปขึ้นเป็นชิปแยกเรียงกัน
 *  ต้องบวกเลขเอง — ตอนนี้รวมเป็นชิปเดียว (จำนวนใบ · ยอดรวม) กดขยายดูรายใบด้านล่าง
 *  แต่ละใบยังกดดูรูปสลิปของตัวเองได้ตามปกติ (ใช้ SlipChip เดิมซ้อนอยู่ข้างใน). */
export function SlipChipGroup({
  sumLabel,
  anyFlagged,
  slips,
}: {
  sumLabel: string;
  anyFlagged: boolean;
  slips: Array<{
    id: string;
    amount: string;
    slipUrl: string | null;
    status: "not_sent" | "sent_unmatched" | "sent_matched";
    flagged: boolean;
    caption: string;
    additionalSlips: SlipAttachment[];
  }>;
}) {
  const [open, setOpen] = useState(false);

  if (slips.length === 0) return null;
  if (slips.length === 1) {
    const s = slips[0];
    return (
      <SlipChip
        amount={s.amount}
        slipUrl={s.slipUrl}
        status={s.status}
        flagged={s.flagged}
        caption={s.caption}
        depositId={s.id}
        additionalSlips={s.additionalSlips}
      />
    );
  }

  return (
    <div style={{ display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rc-slipchip-btn"
        aria-expanded={open}
        aria-label={`ดูสลิปทั้ง ${slips.length} ใบ`}
      >
        <span
          className={`rc-slipchip rc-slipchip-sent${anyFlagged ? " rc-slipchip-flagged" : ""}`}
          title={
            anyFlagged
              ? "มีสลิปติดธงรอตรวจสอบอยู่ในนี้ — กดดูรายใบ"
              : "กดดูสลิปแต่ละใบ"
          }
        >
          {anyFlagged ? "⚠ " : ""}
          {slips.length} ใบ · {sumLabel}
        </span>
      </button>
      {open && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: 4,
            marginTop: 4,
          }}
        >
          {slips.map((s) => (
            <SlipChip
              key={s.id}
              amount={s.amount}
              slipUrl={s.slipUrl}
              status={s.status}
              flagged={s.flagged}
              caption={s.caption}
              depositId={s.id}
              additionalSlips={s.additionalSlips}
            />
          ))}
        </div>
      )}
    </div>
  );
}
