"use client";

// ปุ่ม "ตรวจกระทบยอดตอนนี้" — เรียก /api/dc/reconcile แล้ว refresh หน้าให้เห็นผลล่าสุด.
// ปลอดภัย: API นี้แค่ housekeeping (เลื่อนสถานะโอนค้าง + แนะนำรายการนับ) ไม่ขยับเงิน.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function RerunReconcileButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const busy = pending || running;

  async function run() {
    if (busy) return;
    setErr(null);
    setRunning(true);
    try {
      const res = await fetch("/api/dc/reconcile", { method: "GET", cache: "no-store" });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setErr(data?.error ?? "ตรวจกระทบยอดไม่สำเร็จ");
        return;
      }
      // โหลดข้อมูลฝั่ง server ใหม่ (หน้านี้เป็น server component)
      startTransition(() => router.refresh());
    } catch {
      setErr("เชื่อมต่อไม่ได้ ลองใหม่อีกครั้ง");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="h-9 px-4 rounded-lg bg-[var(--color-brand-600)] text-white text-sm font-bold inline-flex items-center gap-2 hover:bg-[var(--color-brand-700)] disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <RefreshCw size={15} className={busy ? "animate-spin" : ""} />
        {busy ? "กำลังตรวจ…" : "ตรวจกระทบยอดตอนนี้"}
      </button>
      {err && <span className="text-xs font-bold text-red-700">{err}</span>}
    </div>
  );
}
