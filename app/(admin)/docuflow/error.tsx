"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function DocuFlowError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sentry instrumentation auto-captures here.
    console.error("[docuflow-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
      <h2 className="text-xl font-semibold text-zinc-900">
        มีบางอย่างผิดพลาดในโมดูลนี้
      </h2>
      <p className="text-sm text-zinc-600">
        โมดูลอื่นยังใช้งานได้ปกติ · คลิกเพื่อโหลดใหม่
      </p>
      {error.digest ? (
        <p className="text-xs text-zinc-400">รหัสอ้างอิง: {error.digest}</p>
      ) : null}
      <Button onClick={reset}>ลองอีกครั้ง</Button>
    </div>
  );
}
