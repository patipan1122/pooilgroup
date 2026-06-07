"use client";

// Export the reconcile worklist → CSV. Calls the audited exportReconcileCsv
// server action (which enforces expense.export + companyId scope) and downloads
// the returned string as a Blob — no extra API route. Honors the active filters.

import { useTransition, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { exportReconcileCsv } from "../_actions";

export function ReconcileExportButton({
  companyId,
  branchId,
  month,
  vendor,
}: {
  companyId: string;
  branchId: string;
  month: string;
  vendor: string;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function run() {
    setErr(null);
    start(async () => {
      const res = await exportReconcileCsv({
        companyId,
        branchId: branchId || null,
        month: month || null,
        vendor: vendor || null,
      });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    });
  }

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <Download className="size-4" aria-hidden />
        )}
        ส่งออก Excel/CSV
      </button>
      {err && <p className="mt-1 text-xs text-rose-600">{err}</p>}
    </div>
  );
}
