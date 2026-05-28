"use client";

// Reconcile error boundary · matches Pool's pattern (see repairs/error.tsx).
// Keeps the rest of the chairops module functional even if reconcile crashes.

import { useEffect } from "react";

export default function ReconcileError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sentry instrumentation auto-captures here.
    console.error("[chairops/reconcile error]", error);
  }, [error]);

  return (
    <div className="chairops-scope flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-xl font-semibold text-zinc-900">
        เปิดหน้า Reconcile ไม่สำเร็จ
      </h2>
      <p className="max-w-md text-sm text-zinc-600">
        โมดูลอื่นของ ChairOps ยังใช้งานได้ปกติ · ลองโหลดใหม่อีกครั้ง ·
        ถ้ายังไม่ได้ส่ง screenshot + รหัสอ้างอิงให้ทีมเทคนิค
      </p>
      {error.digest && (
        <p className="text-xs text-zinc-400">
          รหัสอ้างอิง: <span className="font-mono">{error.digest}</span>
        </p>
      )}
      <button
        type="button"
        onClick={reset}
        className="h-10 rounded-md bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-800"
      >
        ลองอีกครั้ง
      </button>
    </div>
  );
}
