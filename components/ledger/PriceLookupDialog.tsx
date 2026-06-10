"use client";

// PriceLookupDialog — กดดูราคา/ประวัติการซื้อ จากในใบ (อ่านอย่างเดียว).
// 2 แท็บ: "ตามสินค้า" (ราคาล่าสุด + %เปลี่ยน + กราฟ + ประวัติ) · "ตามผู้ขาย" (เทียบเจ้าไหนถูกสุด).
// เรียก lookupPurchaseHistoryAction (engine เดียวกับ "สมุดค่าใช้จ่าย"); เปลี่ยน term → ดึงใหม่.
import { useEffect, useState } from "react";
import { X, Loader2, TrendingUp, TrendingDown, Crown } from "lucide-react";
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

type VendorCompare = {
  vendor: string;
  latestUnitPrice: number | null;
  minUnitPrice: number | null;
  lastDate: string | null;
  count: number;
};

type Tab = "history" | "vendors";

const baht = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// กราฟเส้นเล็ก (sparkline) จากราคาต่อหน่วย เรียงเก่า→ใหม่. สีตามทิศทาง (ขึ้น=แดง, ลง/เท่า=เขียว).
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 132;
  const h = 34;
  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i * (w - pad * 2)) / (values.length - 1);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y] as const;
  });
  const up = values[values.length - 1] >= values[0];
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={up ? "text-red-400" : "text-emerald-400"}
      aria-hidden
    >
      <polyline
        points={pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={lx.toFixed(1)} cy={ly.toFixed(1)} r="2.5" fill="currentColor" />
    </svg>
  );
}

export function PriceLookupDialog({
  companyId,
  term,
  defaultTab = "history",
  onClose,
}: {
  companyId: string;
  term: string | null;
  defaultTab?: Tab;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [vendors, setVendors] = useState<VendorCompare[]>([]);
  const [tab, setTab] = useState<Tab>(defaultTab);

  useEffect(() => {
    if (!term) return;
    let alive = true;
    void (async () => {
      setTab(defaultTab);
      setLoading(true);
      setHits([]);
      setVendors([]);
      try {
        const r = await lookupPurchaseHistoryAction(term, companyId);
        if (alive) {
          setHits(r.hits as Hit[]);
          setVendors(r.vendorCompare as VendorCompare[]);
        }
      } catch {
        /* keep empty on error */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [term, companyId, defaultTab]);

  useEffect(() => {
    if (!term) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [term, onClose]);

  if (!term) return null;

  // ราคาต่อหน่วย เรียงล่าสุด→เก่า (hits มาจาก docDate desc).
  const series = hits.map((h) => h.itemUnitPrice).filter((p): p is number => p != null && p > 0);
  const latest = series[0] ?? null;
  const prev = series[1] ?? null;
  const avg = series.length ? series.reduce((a, b) => a + b, 0) / series.length : null;
  const high = latest != null && avg != null && latest > avg * 1.1;
  const deltaPct =
    latest != null && prev != null && prev > 0 ? ((latest - prev) / prev) * 100 : null;
  const cheapestMin = vendors.length
    ? Math.min(...vendors.map((v) => v.minUnitPrice ?? Infinity))
    : null;

  return (
    <div
      onClick={onClose}
      className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="ดูราคา / ประวัติการซื้อ"
        className="animate-slide-up-soft max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl sm:rounded-2xl"
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] text-zinc-500">ดูราคา / ประวัติการซื้อ</p>
            <h3 className="truncate text-sm font-bold text-zinc-900">{term}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="press grid size-10 shrink-0 place-items-center rounded-lg text-zinc-500 hover:bg-zinc-100"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* แท็บ */}
        <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setTab("history")}
            className={
              "press min-h-[36px] rounded-lg py-1.5 transition " +
              (tab === "history" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600")
            }
          >
            ตามสินค้า
          </button>
          <button
            type="button"
            onClick={() => setTab("vendors")}
            className={
              "press min-h-[36px] rounded-lg py-1.5 transition " +
              (tab === "vendors" ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-600")
            }
          >
            เทียบผู้ขาย{vendors.length > 1 ? ` (${vendors.length})` : ""}
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
            <Loader2 className="size-4 animate-spin" /> กำลังค้น…
          </div>
        ) : hits.length === 0 ? (
          <div className="py-10 text-center text-sm text-zinc-500">
            ไม่พบประวัติการซื้อของ “{term}”
          </div>
        ) : tab === "history" ? (
          <>
            {latest != null && (
              <div
                className={
                  "mb-3 rounded-xl border p-3 " +
                  (high ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50")
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-zinc-500">ราคาล่าสุด (ต่อหน่วย)</p>
                    <p
                      className={
                        "text-xl font-extrabold tabular-nums " +
                        (high ? "text-red-700" : "text-emerald-700")
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
                  <div className="flex flex-col items-end gap-1">
                    {deltaPct != null && Math.abs(deltaPct) >= 0.5 && (
                      <span
                        className={
                          "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums " +
                          (deltaPct > 0
                            ? "bg-red-100 text-red-700"
                            : "bg-emerald-100 text-emerald-700")
                        }
                      >
                        {deltaPct > 0 ? (
                          <TrendingUp className="size-3" />
                        ) : (
                          <TrendingDown className="size-3" />
                        )}
                        {deltaPct > 0 ? "+" : ""}
                        {deltaPct.toFixed(0)}%
                      </span>
                    )}
                    <Sparkline values={[...series].reverse()} />
                  </div>
                </div>
                {deltaPct != null && Math.abs(deltaPct) >= 0.5 && (
                  <p className="mt-1 text-[11px] text-zinc-500">
                    เทียบครั้งก่อน {baht(prev as number)} ฿ ({deltaPct > 0 ? "แพงขึ้น" : "ถูกลง"})
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
                    <div className="truncate text-[11px] text-zinc-500">
                      {h.docDate || "—"}
                      {h.branchName ? ` · ${h.branchName}` : ""}
                      {h.itemDescription ? ` · ${h.itemDescription}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {h.itemUnitPrice != null ? (
                      <span className="font-bold tabular-nums text-zinc-900">
                        {baht(h.itemUnitPrice)} ฿
                        <span className="text-[10px] font-normal text-zinc-500">/หน่วย</span>
                      </span>
                    ) : (
                      <span className="tabular-nums text-zinc-500">{baht(h.amount)} ฿</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          // ── แท็บ เทียบผู้ขาย ───────────────────────────────────────────────
          <>
            {vendors.filter((v) => v.minUnitPrice != null).length === 0 ? (
              <div className="py-10 text-center text-sm text-zinc-500">
                ยังไม่มีราคาต่อหน่วยให้เทียบ (ลองค้นด้วย “ชื่อสินค้า” แทนชื่อร้าน)
              </div>
            ) : (
              <>
                <ul className="space-y-1.5">
                  {vendors
                    .filter((v) => v.minUnitPrice != null)
                    .map((v) => {
                      const isCheapest =
                        cheapestMin != null && v.minUnitPrice === cheapestMin;
                      return (
                        <li
                          key={v.vendor}
                          className={
                            "rounded-xl border p-3 " +
                            (isCheapest
                              ? "border-emerald-300 bg-emerald-50"
                              : "border-zinc-200 bg-white")
                          }
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-1.5">
                              {isCheapest && (
                                <Crown className="size-3.5 shrink-0 text-emerald-600" aria-hidden />
                              )}
                              <span className="truncate text-sm font-semibold text-zinc-800">
                                {v.vendor}
                              </span>
                              {isCheapest && (
                                <span className="shrink-0 rounded-full bg-emerald-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                                  ถูกสุด
                                </span>
                              )}
                            </div>
                            <span
                              className={
                                "shrink-0 text-base font-extrabold tabular-nums " +
                                (isCheapest ? "text-emerald-700" : "text-zinc-900")
                              }
                            >
                              {baht(v.minUnitPrice as number)} ฿
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between text-[11px] text-zinc-500">
                            <span>
                              ซื้อ {v.count} ครั้ง{v.lastDate ? ` · ล่าสุด ${v.lastDate}` : ""}
                            </span>
                            {v.latestUnitPrice != null &&
                              v.latestUnitPrice !== v.minUnitPrice && (
                                <span className="tabular-nums">
                                  ล่าสุด {baht(v.latestUnitPrice)} ฿
                                </span>
                              )}
                          </div>
                        </li>
                      );
                    })}
                </ul>
                <p className="mt-3 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
                  เทียบจาก “ชื่อบนใบ” ที่พิมพ์ไว้ (อาจไม่ใช่สินค้ารุ่น/ขนาดเดียวกันเป๊ะ)
                  ใช้ดูแนวโน้มราคาคร่าว ๆ
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
