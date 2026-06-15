"use client";

// Shared UI atoms + helpers for the Bank-Recon Controls workspace pages
// (archive · approvals · transfers · special-items). Keeps the 4 client
// components DRY: money formatting, the บาท sign colours, status badges,
// and a small reason-prompt modal used by revert/reject flows.

import { useState } from "react";
import { cn } from "@/lib/utils/cn";

// ── money ────────────────────────────────────────────────────────────────────
// satang → "1,234.56" (absolute value, Thai grouping)
export function baht(satang: number): string {
  return (Math.abs(satang) / 100).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Signed money: credit (+) emerald, debit (−) rose. positive satang = credit.
export function Money({
  satang,
  className,
  showSign = true,
}: {
  satang: number;
  className?: string;
  showSign?: boolean;
}) {
  const credit = satang >= 0;
  const sign = !showSign ? "" : credit ? "+" : "−";
  return (
    <span
      className={cn(
        "tabular-num font-semibold",
        credit ? "text-emerald-600" : "text-rose-600",
        className,
      )}
    >
      {sign}฿{baht(satang)}
    </span>
  );
}

// ── dates ──────────────────────────────────────────────────────────────────
// "2026-06-15" / "2026-06-15 04:37..." → "15 มิ.ย. 2569" (parse components → no TZ shift)
export function thDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return "—";
  return new Date(y, m - 1, d).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ── badges ──────────────────────────────────────────────────────────────────
export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    confirmed: { label: "ยืนยันแล้ว", cls: "bg-emerald-100 text-emerald-700" },
    reversed: { label: "ย้อนแล้ว", cls: "bg-zinc-100 text-zinc-500" },
    PENDING: { label: "รออนุมัติ", cls: "bg-amber-100 text-amber-700" },
    APPROVED: { label: "อนุมัติแล้ว", cls: "bg-emerald-100 text-emerald-700" },
    REJECTED: { label: "ปฏิเสธ", cls: "bg-rose-100 text-rose-700" },
    suggested: { label: "รอยืนยัน", cls: "bg-sky-100 text-sky-700" },
  };
  const m = map[status] ?? { label: status, cls: "bg-zinc-100 text-zinc-500" };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", m.cls)}>
      {m.label}
    </span>
  );
}

// ── reason-prompt modal (used by revert / reject) ────────────────────────────
// Lightweight modal so we never use window.prompt/confirm. Submits a trimmed
// reason string. `busy` disables the confirm while the action runs.
interface ReasonModalProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  confirmTone?: "brand" | "rose";
  minLen?: number;
  placeholder?: string;
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

// Wrapper only mounts the body when open → reason state starts fresh each time
// (no setState-in-effect needed to clear it).
export function ReasonModal(props: ReasonModalProps) {
  if (!props.open) return null;
  return <ReasonModalBody {...props} />;
}

function ReasonModalBody({
  title,
  description,
  confirmLabel,
  confirmTone = "brand",
  minLen = 3,
  placeholder = "ระบุเหตุผล...",
  busy = false,
  onConfirm,
  onClose,
}: ReasonModalProps) {
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= minLen;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="ปิด"
        className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm"
        onClick={busy ? undefined : onClose}
      />
      <div className="relative z-10 w-full rounded-t-2xl border border-zinc-100 bg-white p-5 shadow-soft sm:max-w-md sm:rounded-2xl">
        <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="mt-3 w-full resize-none rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-800 outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        />
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="press min-h-11 flex-1 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => valid && onConfirm(reason.trim())}
            disabled={!valid || busy}
            className={cn(
              "press min-h-11 flex-1 rounded-xl text-sm font-semibold text-white disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-offset-1",
              confirmTone === "rose"
                ? "bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-300"
                : "bg-brand-600 hover:bg-brand-700 focus-visible:ring-brand-300",
            )}
          >
            {busy ? "กำลังบันทึก..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Small toast-ish inline feedback strip.
export function FeedbackBar({
  kind,
  message,
  onDismiss,
}: {
  kind: "ok" | "error";
  message: string;
  onDismiss?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm",
        kind === "ok"
          ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border border-rose-200 bg-rose-50 text-rose-700",
      )}
    >
      <span className="flex-1">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-xs underline-offset-2 hover:underline"
        >
          ปิด
        </button>
      )}
    </div>
  );
}
