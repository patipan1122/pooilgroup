"use client";

// ConfirmDialog — small reusable wrapper around <Dialog> for inline confirms.
// ────────────────────────────────────────────────────────────────────
// Replaces window.confirm() — Brand DNA gate (no native browser modals,
// they look ราชการ).
//
// Usage:
//   <ConfirmDialog
//     trigger={<button>ลบ</button>}
//     title="ยืนยันลบ"
//     body="ลบสาขา X จากเอกสารนี้?"
//     confirmLabel="ลบ"
//     onConfirm={async () => { await deleteIt(); }}
//   />
//
// `onConfirm` may be sync or async; while it runs the confirm button
// shows a loading state and the dialog stays open.
// ────────────────────────────────────────────────────────────────────

import { cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import { Button } from "./button";
import { Dialog } from "./dialog";

interface ConfirmDialogProps {
  /** The element that opens the dialog (e.g. a delete button). Receives onClick. */
  trigger: ReactElement;
  title: string;
  body: ReactNode;
  /** Label on the destructive confirm button. Default "ยืนยัน". */
  confirmLabel?: string;
  /** Label on the cancel button. Default "ยกเลิก". */
  cancelLabel?: string;
  /** Variant for the confirm button — default "danger". */
  variant?: "primary" | "danger";
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  trigger,
  title,
  body,
  confirmLabel = "ยืนยัน",
  cancelLabel = "ยกเลิก",
  variant = "danger",
  onConfirm,
}: ConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    setBusy(true);
    try {
      await onConfirm();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  function close() {
    if (busy) return;
    setOpen(false);
  }

  // Inject onClick into the trigger element. We avoid wrapping in an extra
  // <button> to preserve the caller's semantics + styling.
  const triggerWithClick = isValidElement(trigger)
    ? cloneElement(trigger as ReactElement<{ onClick?: (e: React.MouseEvent) => void }>, {
        onClick: (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        },
      })
    : trigger;

  return (
    <>
      {triggerWithClick}
      <Dialog open={open} onClose={close} title={title}>
        <div className="space-y-5">
          <div className="text-sm text-zinc-700 leading-relaxed">{body}</div>
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-100">
            <Button variant="ghost" onClick={close} disabled={busy}>
              {cancelLabel}
            </Button>
            <Button
              variant={variant}
              onClick={handleConfirm}
              loading={busy}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
