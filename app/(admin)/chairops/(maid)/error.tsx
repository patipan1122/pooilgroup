"use client";

// Maid PWA error boundary · Thai copy · single recovery action.
// 2026-09-20 bigsolvebug P0 fix: this route group (and app/(admin)/chairops
// as a whole) had NO error.tsx anywhere in the maid tree — an uncaught error
// (e.g. a dropped connection mid-submit on slow 4G) fell through to Next's
// generic crash page with no Thai copy and no way back into the app.
// Per Next.js convention — must be a client component with `error` + `reset` props.
// No backdrop-blur (W6 constraint, Chrome <80) — solid background only.

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export default function MaidShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[chairops/(maid)] render error", error);
  }, [error]);

  return (
    <div className="chairops-scope flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-7" aria-hidden="true" />
      </span>
      <div>
        <h1 className="text-lg font-bold text-foreground">เปิดหน้านี้ไม่สำเร็จ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          อาจเป็นเพราะสัญญาณเน็ตหลุดชั่วคราว — ถ้าเพิ่งกด "บันทึก" หรือ
          "ฝากเงิน" ระบบกันข้อมูลซ้ำไว้แล้ว กดลองอีกครั้งได้เลย ไม่ซ้ำเงิน
          หรือซ้ำรอบแน่นอน
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
            ref: {error.digest}
          </p>
        )}
      </div>
      <div className="flex w-full max-w-xs flex-col gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          ลองอีกครั้ง
        </button>
        <Link
          href="/chairops/m"
          className="inline-flex h-12 items-center justify-center rounded-md border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted"
        >
          กลับหน้าหลัก
        </Link>
      </div>
    </div>
  );
}
