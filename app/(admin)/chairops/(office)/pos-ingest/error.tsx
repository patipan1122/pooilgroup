"use client";

// W3 (claude-design) · POS Ingest error boundary.
import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function PosIngestError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[pos-ingest] error boundary:", error);
  }, [error]);

  return (
    <div className="chairops-scope mx-auto max-w-2xl p-4 sm:p-6">
      <Card className="p-6">
        <h1 className="text-lg font-semibold text-rose-700">
          เกิดข้อผิดพลาดในหน้า POS Ingest
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message || "ระบบมีปัญหา · กรุณาลองอีกครั้ง"}
        </p>
        {error.digest && (
          <p className="mt-1 text-xs text-muted-foreground">
            digest: <code>{error.digest}</code>
          </p>
        )}
        <div className="mt-4 flex items-center gap-2">
          <Button type="button" onClick={() => reset()}>
            ลองอีกครั้ง
          </Button>
          <Link
            href="/chairops/pos-ingest"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-900 transition-all duration-150 hover:bg-zinc-50"
          >
            กลับรายการ import
          </Link>
        </div>
      </Card>
    </div>
  );
}
