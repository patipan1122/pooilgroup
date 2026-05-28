"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

export default function RecruitError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[recruit-error]", error);
  }, [error]);

  return (
    <div className="p-8 sm:p-12 max-w-2xl mx-auto">
      <div className="rounded-3xl border-2 border-red-200 bg-red-50/40 p-8 text-center">
        <div className="size-14 mx-auto rounded-2xl bg-red-100 border-2 border-red-200 flex items-center justify-center text-red-700">
          <AlertCircle className="size-7" />
        </div>
        <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-zinc-900 font-display">
          เกิดข้อผิดพลาดในโปรแกรมรับสมัคร
        </h1>
        <p className="text-sm text-zinc-600 mt-2 leading-relaxed">
          {error.message || "เกิดข้อผิดพลาดที่ไม่คาดคิด · ลองอีกครั้งหรือกลับหน้าหลัก"}
        </p>
        {error.digest && (
          <p className="text-[10px] font-mono text-zinc-400 mt-2">
            error id: {error.digest}
          </p>
        )}
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="h-11 px-4 rounded-xl bg-[var(--color-brand-600)] text-white font-bold text-sm hover:bg-[var(--color-brand-700)]"
          >
            ลองอีกครั้ง
          </button>
          <Link
            href="/home"
            className="h-11 px-4 inline-flex items-center rounded-xl border border-zinc-300 text-zinc-700 font-bold text-sm hover:bg-zinc-50"
          >
            กลับหน้าหลัก
          </Link>
        </div>
      </div>
    </div>
  );
}
