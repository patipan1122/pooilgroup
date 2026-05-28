"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertOctagon, RefreshCw } from "lucide-react";

export default function CashHubError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[CashHub error boundary]", error);
  }, [error]);

  return (
    <div className="p-6 max-w-md mx-auto">
      <div className="bg-white rounded-2xl border-2 border-red-200 p-6 text-center">
        <div className="size-14 mx-auto rounded-2xl bg-red-50 flex items-center justify-center mb-4">
          <AlertOctagon className="size-7 text-red-600" />
        </div>
        <h2 className="text-xl font-extrabold font-display text-zinc-900">
          เกิดข้อผิดพลาด
        </h2>
        <p className="text-sm text-zinc-600 mt-2">
          หน้านี้โหลดไม่สำเร็จ · ลองรีเฟรชอีกครั้ง · ถ้ายังไม่ได้แจ้งผู้ดูแลระบบ
        </p>
        {error.digest && (
          <p className="text-[11px] text-zinc-400 mt-3 font-mono">
            รหัสอ้างอิง: {error.digest}
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-2 mt-5">
          <button
            type="button"
            onClick={reset}
            className="flex-1 h-11 rounded-xl bg-[var(--color-brand-600)] text-white font-semibold inline-flex items-center justify-center gap-2 hover:bg-[var(--color-brand-700)]"
          >
            <RefreshCw className="size-4" />
            ลองอีกครั้ง
          </button>
          <Link
            href="/cashhub/dashboard"
            className="flex-1 h-11 rounded-xl border-2 border-zinc-200 text-zinc-700 font-semibold inline-flex items-center justify-center hover:bg-zinc-50"
          >
            กลับหน้าหลัก
          </Link>
        </div>
      </div>
    </div>
  );
}
