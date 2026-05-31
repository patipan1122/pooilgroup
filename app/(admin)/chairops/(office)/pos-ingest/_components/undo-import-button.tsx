"use client";

// Wave-2 B1 (CEO 2026-05-31) · Undo button for a freshly-committed POS
// import. Triggers undoImport server action · refreshes the route.
// Shown on the pos-ingest landing as part of the post-commit notification
// AND on each row in the imports table when commit < 60 min old.

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Undo2, Loader2 } from "lucide-react";
import { undoImport } from "@/app/(admin)/chairops/pos-ingest/actions";

interface Props {
  importId: string;
  /** Display variant: "banner" = large prominent button · "row" = compact icon button. */
  variant?: "banner" | "row";
  /** Optional confirmation prompt to surface before calling undo (banner only). */
  filename?: string;
}

export function UndoImportButton({ importId, variant = "row", filename }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function runUndo() {
    startTransition(async () => {
      const res = await undoImport(importId);
      if (!res.ok) {
        toast.error(res.error);
        setConfirming(false);
        return;
      }
      toast.success(`Undo สำเร็จ · ลบ ${res.rowsRemoved.toLocaleString("th-TH")} แถว`);
      router.push("/chairops/pos-ingest");
      router.refresh();
    });
  }

  if (variant === "banner") {
    if (!confirming) {
      return (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={pending}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 text-sm font-medium text-amber-900 hover:bg-amber-50"
        >
          <Undo2 className="h-4 w-4" aria-hidden /> ยกเลิก import นี้
        </button>
      );
    }
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-amber-900">
          ยกเลิก{filename ? ` "${filename}"` : ""}จริงไหม · จะลบทุกแถวที่เพิ่งบันทึก
        </span>
        <button
          type="button"
          onClick={runUndo}
          disabled={pending}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-rose-600 px-3 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Undo2 className="h-4 w-4" aria-hidden />
          )}
          ยืนยัน undo
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="inline-flex h-9 items-center rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          ไม่ยกเลิก
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={runUndo}
      disabled={pending}
      title="undo (ภายใน 60 นาทีหลัง commit)"
      className="inline-flex h-8 items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <Undo2 className="h-3.5 w-3.5" aria-hidden />
      )}
      undo
    </button>
  );
}
