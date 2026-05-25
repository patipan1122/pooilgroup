"use client";

// Error boundary for /chairops/write-offs.
// Mirrors the alerts boundary for visual consistency.

import { useEffect } from "react";

export default function WriteOffsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      const sentry = (
        window as unknown as {
          Sentry?: { captureException: (e: unknown) => void };
        }
      ).Sentry;
      sentry?.captureException(error);
    }
    // eslint-disable-next-line no-console
    console.error("[chairops/write-offs] render error", error);
  }, [error]);

  return (
    <div className="chairops-scope mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-rose-700">
        เกิดข้อผิดพลาด
      </div>
      <h1 className="text-2xl font-bold text-zinc-900">
        โหลดหน้า Write-offs ไม่สำเร็จ
      </h1>
      <p className="text-sm text-zinc-600">
        ลองรีเฟรชอีกครั้ง · ถ้ายังเจอปัญหาเดิม กรุณาแจ้งทีมเทคนิคพร้อมรหัสด้านล่าง
      </p>
      {error.digest && (
        <code className="rounded bg-zinc-100 px-2 py-1 text-xs text-zinc-700">
          digest: {error.digest}
        </code>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800"
        >
          ลองอีกครั้ง
        </button>
        <a
          href="/chairops/dashboard"
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          กลับ Dashboard
        </a>
      </div>
    </div>
  );
}
