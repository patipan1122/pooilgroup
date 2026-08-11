"use client";

// ปุ่ม "ดึงจากชีตเดี๋ยวนี้" — ต้องมี feedback ชัด (CEO 2026-08-11: กดแล้วไม่รู้ว่าได้ผลไหม)
// ใช้ useActionState เพื่อรู้สถานะ pending + ผลลัพธ์ → เด้ง toast บอกสำเร็จ/ล้มเหลว

import { useActionState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { syncHotelNowAction, type SyncHotelNowState } from "./actions";

export function HotelSyncButton({
  branchId,
  monthStr,
}: {
  branchId: string;
  monthStr: string;
}) {
  const [state, action, pending] = useActionState<SyncHotelNowState, FormData>(
    syncHotelNowAction,
    null,
  );
  const shown = useRef<SyncHotelNowState>(null);

  useEffect(() => {
    if (!state || state === shown.current) return;
    shown.current = state;
    if (state.ok) toast.success(state.message);
    else toast.error(state.message);
  }, [state]);

  return (
    <form action={action}>
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="month" value={monthStr} />
      <button
        type="submit"
        disabled={pending}
        className="h-10 inline-flex items-center gap-1.5 rounded-xl bg-[var(--color-brand-600,#1e3aff)] text-white font-semibold px-4 text-sm shadow-sm hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "🔄 กำลังดึง…" : "🔄 ดึงจากชีตเดี๋ยวนี้"}
      </button>
    </form>
  );
}
