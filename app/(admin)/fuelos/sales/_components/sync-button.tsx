"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/fuelos/utils/cn";
import { actSyncSalesNow } from "../actions";

// ปุ่ม "ดึงเดี๋ยวนี้" — ยิงไป TRCloud อัปยอดขาย/ลูกหนี้ล่าสุด
export function SyncButton({
  label = "ดึงเดี๋ยวนี้",
  variant = "primary",
}: {
  label?: string;
  variant?: "primary" | "outline";
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  function run() {
    setMsg(null);
    start(async () => {
      try {
        const res = await actSyncSalesNow();
        setMsg(res.ok ? { ok: true, text: `อัปเดตแล้ว ${res.synced.toLocaleString("th-TH")} ใบ` } : { ok: false, text: res.error ?? "ดึงไม่สำเร็จ" });
        router.refresh();
      } catch (e) {
        setMsg({ ok: false, text: e instanceof Error ? e.message : "เกิดข้อผิดพลาด" });
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span className={cn("text-xs inline-flex items-center gap-1", msg.ok ? "text-emerald-600" : "text-red-600")}>
          {msg.ok ? <Check className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
          {msg.text}
        </span>
      )}
      <button
        onClick={run}
        disabled={pending}
        className={cn(
          "inline-flex items-center gap-1.5 h-10 px-4 rounded-xl text-sm font-medium disabled:opacity-60",
          variant === "primary" ? "bg-brand-600 text-white" : "bg-surface border border-border text-zinc-700",
        )}
      >
        <RefreshCw className={cn("size-4", pending && "animate-spin")} />
        {pending ? "กำลังดึง…" : label}
      </button>
    </div>
  );
}
