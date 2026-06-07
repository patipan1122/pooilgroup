"use client";

// SyncSkusCard — ดึง/อัปเดต SKU จาก TRCloud เข้าฐานข้อมูล (mirror เท่านั้น ไม่สร้างใหม่).
// ตอน sync ระบบจะ auto-จับคู่ "ชื่อสินค้าใน TRCloud → SKU" ให้ด้วย (ตรงเป๊ะ ปลอดภัย).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Boxes, Loader2, RefreshCw } from "lucide-react";
import { syncSkusAction } from "../../_stockin-actions";

export function SyncSkusCard({ companyId, skuCount }: { companyId: string; skuCount: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [keyword, setKeyword] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  function runSync() {
    setMsg(null);
    start(async () => {
      const res = await syncSkusAction(companyId, keyword.trim() || undefined);
      if (res.ok) {
        setMsg({
          kind: "ok",
          text: `ดึงจาก TRCloud ${res.synced ?? 0} รายการ${res.seeded ? ` · จับคู่ชื่อให้อัตโนมัติ ${res.seeded}` : ""}`,
        });
        router.refresh();
      } else {
        setMsg({ kind: "err", text: res.error ?? "ดึงไม่สำเร็จ" });
      }
    });
  }

  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
      <div className="mb-2 flex items-center gap-2">
        <Boxes className="size-4 text-[var(--color-brand-600,#2563EB)]" aria-hidden />
        <h3 className="text-sm font-bold text-zinc-800">ดึงสินค้าจาก TRCloud</h3>
        <span className="ml-auto rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600">{skuCount} SKU</span>
      </div>
      <p className="mb-2 text-xs text-zinc-500">
        ดึงรายการสินค้ามาเก็บไว้ (ไม่สร้างใหม่) · ใส่คำค้น/หมวด เช่น “OIL” “H_S” หรือเว้นว่าง=ทั้งหมด · ระบบจับคู่ชื่อ TRCloud ให้อัตโนมัติ
      </p>
      <div className="flex gap-2">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="คำค้น (เว้นว่าง=ทั้งหมด)"
          className="h-10 flex-1 rounded-lg border border-zinc-200 px-3 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
        />
        <button
          type="button"
          onClick={runSync}
          disabled={pending}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[var(--color-brand-600,#2563EB)] px-4 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} ดึง/อัปเดต
        </button>
      </div>
      {msg && (
        <p className={"mt-2 text-xs " + (msg.kind === "ok" ? "text-emerald-700" : "text-rose-700")} role="status">{msg.text}</p>
      )}
    </div>
  );
}
