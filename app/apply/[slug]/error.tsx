"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

export default function ApplyError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[apply-error]", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-zinc-50">
      <div className="max-w-md w-full bg-white rounded-3xl border-2 border-red-200 p-8 text-center">
        <div className="size-14 mx-auto rounded-2xl bg-red-100 border-2 border-red-200 flex items-center justify-center text-red-700">
          <AlertCircle className="size-7" />
        </div>
        <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-zinc-900 font-display">
          เกิดข้อผิดพลาด
        </h1>
        <p className="text-sm text-zinc-600 mt-2 leading-relaxed">
          ขออภัย · ตอนนี้เปิดหน้าใบสมัครไม่ได้ ·
          ลองรีเฟรชใหม่หรือติดต่อ HR ของบริษัท
        </p>
        <div className="mt-6 flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="h-12 px-5 rounded-xl bg-[var(--color-brand-600)] text-white font-bold text-sm hover:bg-[var(--color-brand-700)]"
          >
            ลองอีกครั้ง
          </button>
        </div>
      </div>
    </div>
  );
}
