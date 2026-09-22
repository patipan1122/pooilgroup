"use client";

// Slip viewer — click a deposit amount or the "สลิป" badge in the reconcile
// ledger to pop the deposit slip image up full-screen (CEO 2026-06-03).
// Non-modal-feel lightbox: dark overlay, click-outside / Esc / X to close.
// The ledger table itself is a server component, so these are the small
// client islands it embeds for the two interactive cells.

import { Paperclip, X } from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { clearDepositReview } from "@/app/(admin)/chairops/(office)/review-queue/actions";

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
}: {
  amount: string;
  slipUrl: string | null;
  caption: string;
  status: "not_sent" | "sent_unmatched" | "sent_matched";
  flagged: boolean;
  /** เมื่อมีค่า + flagged=true → โชว์ปุ่ม "ตรวจแล้ว ปกติ" ในป็อปอัพดูสลิป. */
  depositId?: string;
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rc-slipchip-btn"
        aria-label="ดูสลิปฝากเงิน"
      >
        {chip}
      </button>
      {open && (
        <Lightbox
          url={slipUrl}
          caption={caption}
          onClose={() => setOpen(false)}
          footer={
            flagged && depositId ? (
              <ConfirmReviewedForm depositId={depositId} />
            ) : undefined
          }
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
            />
          ))}
        </div>
      )}
    </div>
  );
}
