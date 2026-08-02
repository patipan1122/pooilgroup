"use client";

// CEO 2026-08-02 (Pinpoint) · "🔄 เช็คตู้เสียด่วน กดแล้วเหมือนใช้ไม่ได้".
// The button IS wired (form + server action revalidate+redirect), but with the
// detector running live on every render the list rarely changes AND there was
// zero visible feedback → it looked like a no-op. useFormStatus gives an
// immediate "กำลังเช็ก…" pending state the instant the CEO clicks, so the
// action never feels dead again.
import { useFormStatus } from "react-dom";

export function RecheckButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="h-9 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? "⏳ กำลังเช็ก…" : "🔄 เช็คตู้เสียด่วน"}
    </button>
  );
}
