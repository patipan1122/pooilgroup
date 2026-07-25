"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { actSyncTrcloudDocs } from "../actions";

export function SyncButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run() {
    setMsg(null);
    startTransition(async () => {
      const r = await actSyncTrcloudDocs();
      if (!r.ok) {
        setMsg({ ok: false, text: r.error ?? "ดึงข้อมูลไม่สำเร็จ" });
        return;
      }
      const parts = [`AP +${r.ap}`, `PO +${r.po}`];
      let text = `อัปเดตแล้ว (${parts.join(" · ")})`;
      if (r.rateLimited) text += " · TRCloud จำกัดการเรียก หยุดกลางคัน ลองรีเฟรชอีกครั้งใน 1–2 นาที";
      else if (r.cappedAp || r.cappedPo) text += " · ยังมีของเก่ากว่านี้ กดรีเฟรชซ้ำเพื่อดึงต่อ";
      setMsg({ ok: true, text });
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className={`text-xs ${msg.ok ? "text-emerald-600" : "text-rose-600"}`}>{msg.text}</span>
      )}
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-medium bg-[var(--color-brand-600)] text-white hover:opacity-90 disabled:opacity-60"
      >
        <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
        {pending ? "กำลังดึง…" : "รีเฟรชจาก TRCloud"}
      </button>
    </div>
  );
}
