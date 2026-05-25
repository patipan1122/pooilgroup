"use client";

// Office shell error boundary · Thai copy · single recovery action.
// Per Next.js convention — must be a client component with `error` + `reset` props.

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";

export default function OfficeShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the server log via the standard Next.js mechanism.
    // No client-side telemetry library wired yet (Wave 2).
    console.error("[chairops/(office)] render error", error);
  }, [error]);

  return (
    <div className="chairops-scope mx-auto flex max-w-xl flex-col items-center gap-4 rounded-2xl border border-destructive/30 bg-destructive/5 p-8 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-6" aria-hidden="true" />
      </span>
      <div>
        <h1 className="text-lg font-bold text-foreground">
          เปิดหน้านี้ไม่สำเร็จ
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          เกิดข้อผิดพลาดระหว่างโหลดข้อมูล ลองโหลดใหม่ ถ้ายังเป็นเหมือนเดิม
          แจ้งทีมเทคได้เลย
        </p>
        {error.digest && (
          <p className="mt-2 font-mono text-[10px] text-muted-foreground">
            ref: {error.digest}
          </p>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          ลองอีกครั้ง
        </button>
        <Link
          href="/dashboard"
          className="inline-flex h-9 items-center rounded-md border border-border bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted"
        >
          กลับหน้าหลัก Pool
        </Link>
      </div>
    </div>
  );
}
