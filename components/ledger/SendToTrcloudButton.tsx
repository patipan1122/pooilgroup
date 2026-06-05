"use client";

// Per-receipt "ส่งเข้า TRCloud" button (detail pane header). Pushes ONE confirmed
// expense INTO TRCloud as an AP via the sendExpenseToTrcloud server action (which
// runs vendor + SKU search-before-create then ap/create). Idempotent: once a row
// shows a TRCloud doc no. it renders the "ส่งแล้ว" badge instead of the button.
import { useState, useTransition } from "react";
import { Send, Loader2, CloudCheck, RefreshCw } from "lucide-react";
import { sendExpenseToTrcloud } from "@/app/(admin)/ledger/_actions";

export function SendToTrcloudButton({
  expenseId,
  status,
  trcloudDocId,
  trcloudDocNo,
  trcloudError,
}: {
  expenseId: string;
  status: string;
  trcloudDocId: string | null;
  trcloudDocNo: string | null;
  trcloudError: string | null;
}) {
  const sendable = status === "confirmed" || status === "locked";
  const [pending, start] = useTransition();
  const [sent, setSent] = useState<string | null>(
    trcloudDocId ? trcloudDocNo ?? "ส่งแล้ว" : null,
  );
  const [err, setErr] = useState<string | null>(trcloudError);

  if (sent) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1.5 text-xs font-semibold text-blue-700"
        title="ส่งเข้า TRCloud แล้ว"
      >
        <CloudCheck className="size-3.5" />
        ส่ง TRCloud แล้ว{sent !== "ส่งแล้ว" ? ` · ${sent}` : ""}
      </span>
    );
  }

  function run() {
    setErr(null);
    start(async () => {
      const res = await sendExpenseToTrcloud(expenseId);
      if (res.ok) setSent(res.docNo ?? "ส่งแล้ว");
      else setErr(res.error ?? "ส่งไม่สำเร็จ");
    });
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        onClick={run}
        disabled={pending || !sendable}
        title={sendable ? "ส่งใบนี้เข้า TRCloud (ใบกำกับภาษีซื้อ AP)" : "ยืนยันรายการก่อนจึงส่งได้"}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:bg-zinc-300"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : err ? (
          <RefreshCw className="size-4" />
        ) : (
          <Send className="size-4" />
        )}
        {err ? "ลองส่งอีกครั้ง" : "ส่งเข้า TRCloud"}
      </button>
      {err && <span className="max-w-[16rem] text-right text-[11px] text-rose-600">{err}</span>}
    </div>
  );
}
