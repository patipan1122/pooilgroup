"use client";

// CEO 2026-06-01 escape hatch: if the in-action diffSummary patch lagged
// (Vercel deploy delay, browser cache, anything else), this button rebuilds
// the preview against the CURRENT state of ChairopsBranch right now and
// refreshes the page. One click → "ผิด" rows whose storeName now matches
// a real branch flip to "ใหม่" and the counters update.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, Loader2 } from "lucide-react";
import { reresolveImportDiff } from "@/app/(admin)/chairops/pos-ingest/multi-actions";

export function ReresolveButton({ importId }: { importId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const r = await reresolveImportDiff(importId);
      if (!r.ok) {
        toast.error(r.error ?? "re-resolve ล้มเหลว");
        return;
      }
      if ((r.rowsPatched ?? 0) === 0) {
        toast(`ไม่มีอะไรต้อง re-resolve · counts: ใหม่ ${r.newCount} · ผิด ${r.errorCount}`);
      } else {
        toast.success(
          `Re-resolve สำเร็จ · patch ${r.rowsPatched} แถว · counts: ใหม่ ${r.newCount} · ผิด ${r.errorCount}`,
        );
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="inline-flex h-9 items-center gap-1.5 rounded-md border border-zinc-300 bg-white px-3 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
      title="ตรวจ ChairopsBranch ปัจจุบัน + อัปเดต preview · ใช้เมื่อเพิ่มสาขาแล้วแต่ตัวเลขยังไม่กลับเป็น 0"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" aria-hidden />
      )}
      Re-resolve preview
    </button>
  );
}
