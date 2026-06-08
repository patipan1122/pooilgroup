"use client";

// PriceLookupDialog — กดดูราคา/ประวัติการซื้อ (รายสินค้า หรือ ผู้ขาย) จากในใบ.
// อ่านอย่างเดียว: เรียก lookupPurchaseHistoryAction (engine เดียวกับ "สมุดค่าใช้จ่าย").
// คุมด้วย `term` (null = ปิด); เปลี่ยน term → ดึงข้อมูลใหม่.
import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { lookupPurchaseHistoryAction } from "@/app/(admin)/ledger/_actions";

type Hit = {
  id: string;
  docCode: string;
  vendor: string | null;
  branchName: string | null;
  docDate: string | null;
  amount: number;
  itemDescription: string | null;
  itemUnitPrice: number | null;
};

const baht = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function PriceLookupDialog({
  companyId,
  term,
  onClose,
}: {
  companyId: string;
  term: string | null;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);

  useEffect(() => {
    if (!term) return;
    let alive = true;
    void (async () => {
      setLoading(true);
      setHits([]);
      try {
        const r = await lookupPurchaseHistoryAction(term, companyId);
        if (alive) setHits(r.hits as Hit[]);
      } catch {
        /* keep empty on error */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [term, companyId]);

  useEffect(() => {
    if (!term) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [term, onClose]);

  if (!term) return null;

  const prices = hits.map((h) => h.itemUnitPrice).filter((p): p is number => p != null);
  const latest = prices[0] ?? null;
  const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
  const high = latest != null && avg != null && latest > avg * 1.1;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="ดูราคา / ประวัติการซื้อ"
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl"
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] text-zinc-400">ดูราคา / ประวัติการซื้อ</p>
            <h3 className="truncate text-sm font-bold text-zinc-900">{term}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100"
          >
            <X className="size-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-400">
            <Loader2 className="size-4 animate-spin" /> กำลังค้น…
          </div>
        ) : hits.length === 0 ? (
          <div className="py-10 text-center text-sm text-zinc-400">
            ไม่พบประวัติการซื้อของ “{term}”
          </div>
        ) : (
          <>
            {latest != null && (
              <div
                className={
                  "mb-3 rounded-xl border p-3 " +
                  (high ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50")
                }
              >
                <p className="text-[11px] text-zinc-500">ราคาล่าสุด (ต่อหน่วย)</p>
                <p
                  className={
                    "text-xl font-extrabold tabular-nums " +
                    (high ? "text-rose-600" : "text-emerald-700")
                  }
                >
                  {baht(latest)} ฿
                </p>
                {avg != null && (
                  <p className="text-[11px] text-zinc-500">
                    เฉลี่ย {baht(avg)} ฿{high ? " · ครั้งนี้แพงกว่าเฉลี่ย" : ""}
                  </p>
                )}
              </div>
            )}
            <p className="mb-1 text-[11px] font-semibold text-zinc-500">
              ประวัติการซื้อ ({hits.length})
            </p>
            <ul className="divide-y divide-zinc-100 rounded-xl border border-zinc-200">
              {hits.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-zinc-700">
                      {h.vendor || "ไม่ระบุผู้ขาย"}
                    </div>
                    <div className="truncate text-[11px] text-zinc-400">
                      {h.docDate || "—"}
                      {h.branchName ? ` · ${h.branchName}` : ""}
                      {h.itemDescription ? ` · ${h.itemDescription}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {h.itemUnitPrice != null ? (
                      <span className="font-bold tabular-nums text-zinc-900">
                        {baht(h.itemUnitPrice)} ฿
                        <span className="text-[10px] font-normal text-zinc-400">/หน่วย</span>
                      </span>
                    ) : (
                      <span className="tabular-nums text-zinc-500">{baht(h.amount)} ฿</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
