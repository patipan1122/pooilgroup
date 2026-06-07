"use client";

// StockInButton — รับสินค้าเข้าคลัง TRCloud จากใบเสร็จที่ยืนยันแล้ว (LEDGER_STOCKIN_V1).
// กด → ส่งเข้าคลัง · ถ้ามีบรรทัดที่ยังไม่จับคู่ SKU → โชว์ตัวเลือกให้จับคู่ตรงนั้น แล้วส่งซ้ำ.
// stock เพิ่มทันทีที่ส่ง (verified) → บัญชี/แอดมินเท่านั้น · กันส่งซ้ำที่ server.

import { useState, useTransition } from "react";
import { Boxes, Loader2, CheckCircle2, AlertTriangle, Link2 } from "lucide-react";
import { sendExpenseStockIn, mapSkuAlias, resetExpenseStockIn } from "@/app/(admin)/ledger/_stockin-actions";

type SkuOpt = { id: string; productId: string; productName: string | null; businessGroup: string | null };

export function StockInButton({
  expenseId,
  companyId,
  alreadyStockedNo,
  stockSkus,
}: {
  expenseId: string;
  companyId: string;
  /** ถ้าส่งเข้าคลังแล้ว = เลขเอกสาร (โชว์สถานะ) */
  alreadyStockedNo?: string | null;
  /** SKU ที่เปิด "เก็บสต๊อก" ไว้ — สำหรับจับคู่บรรทัดที่ยังไม่รู้จัก */
  stockSkus: SkuOpt[];
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [unmatched, setUnmatched] = useState<string[] | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({}); // aliasText → skuId
  const [done, setDone] = useState(!!alreadyStockedNo);

  if (done) {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
        <CheckCircle2 className="size-4" /> รับเข้าคลังแล้ว{alreadyStockedNo && alreadyStockedNo !== "sent" ? ` · ${alreadyStockedNo}` : ""}
      </p>
    );
  }

  function run() {
    setMsg(null);
    start(async () => {
      const res = await sendExpenseStockIn(expenseId);
      if (res.ok) {
        setDone(true);
        setUnmatched(null);
        setMsg({ kind: "ok", text: `รับเข้าคลังแล้ว${res.docNo ? ` · ${res.docNo}` : ""}` });
      } else if (res.unmatched && res.unmatched.length > 0) {
        setUnmatched(res.unmatched);
        setMsg({ kind: "err", text: "มีสินค้าที่ยังไม่จับคู่ SKU — เลือก SKU ให้ครบแล้วกดส่งอีกครั้ง" });
      } else {
        setMsg({ kind: "err", text: res.error ?? "รับเข้าคลังไม่สำเร็จ" });
      }
    });
  }

  function reset() {
    setMsg(null);
    start(async () => {
      const res = await resetExpenseStockIn(expenseId);
      if (res.ok) {
        setUnmatched(null);
        setMsg({ kind: "ok", text: "รีเซ็ตแล้ว · กดรับเข้าคลังใหม่ได้" });
      } else {
        setMsg({ kind: "err", text: res.error ?? "รีเซ็ตไม่สำเร็จ" });
      }
    });
  }

  function saveMappingsAndRetry() {
    if (!unmatched) return;
    const missing = unmatched.filter((t) => !picks[t]);
    if (missing.length > 0) {
      setMsg({ kind: "err", text: `ยังเลือก SKU ไม่ครบ (${missing.length} รายการ)` });
      return;
    }
    start(async () => {
      for (const text of unmatched) {
        const r = await mapSkuAlias(companyId, text, picks[text]);
        if (!r.ok) {
          setMsg({ kind: "err", text: r.error ?? "จับคู่ไม่สำเร็จ" });
          return;
        }
      }
      // all mapped → retry the stock-in
      const res = await sendExpenseStockIn(expenseId);
      if (res.ok) {
        setDone(true);
        setUnmatched(null);
        setMsg({ kind: "ok", text: `รับเข้าคลังแล้ว${res.docNo ? ` · ${res.docNo}` : ""}` });
      } else if (res.unmatched?.length) {
        setUnmatched(res.unmatched);
        setMsg({ kind: "err", text: "ยังมีบรรทัดที่จับคู่ไม่ได้" });
      } else {
        setMsg({ kind: "err", text: res.error ?? "รับเข้าคลังไม่สำเร็จ" });
      }
    });
  }

  return (
    <div className="mt-2">
      {!unmatched && (
        <button
          type="button"
          onClick={run}
          disabled={pending}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] px-3 text-sm font-semibold text-[var(--color-brand-700)] hover:bg-[var(--color-brand-100)] disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Boxes className="size-4" />}
          รับเข้าคลัง (TRCloud)
        </button>
      )}

      {unmatched && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-800">
            <Link2 className="size-4" /> จับคู่สินค้ากับ SKU ในคลัง
          </p>
          <ul className="space-y-2">
            {unmatched.map((text) => (
              <li key={text} className="flex flex-col gap-1 sm:flex-row sm:items-center">
                <span className="min-w-0 flex-1 truncate text-sm text-zinc-700">“{text}”</span>
                <select
                  value={picks[text] ?? ""}
                  onChange={(e) => setPicks((p) => ({ ...p, [text]: e.target.value }))}
                  className="h-9 rounded-lg border border-zinc-200 bg-white px-2 text-sm outline-none focus:ring-2 focus:ring-[var(--color-brand-200)]"
                >
                  <option value="">— เลือก SKU —</option>
                  {stockSkus.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.productId} · {s.productName ?? ""}{s.businessGroup ? ` (${s.businessGroup})` : ""}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={saveMappingsAndRetry}
            disabled={pending}
            className="mt-3 inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[var(--color-brand-600,#2563EB)] px-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
            จับคู่ + รับเข้าคลัง
          </button>
          {stockSkus.length === 0 && (
            <p className="mt-2 text-[11px] text-amber-700">
              ยังไม่มี SKU ที่เปิด “เก็บสต๊อก” — ไปตั้งที่ ตั้งค่า → คลังสินค้า ก่อน
            </p>
          )}
        </div>
      )}

      {msg && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p className={"inline-flex items-center gap-1 text-xs " + (msg.kind === "ok" ? "text-emerald-700" : "text-rose-700")}>
            {msg.kind === "ok" ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
            {msg.text}
          </p>
          {msg.kind === "err" && !unmatched && (
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50"
            >
              รีเซ็ต/ลองใหม่
            </button>
          )}
        </div>
      )}
    </div>
  );
}
