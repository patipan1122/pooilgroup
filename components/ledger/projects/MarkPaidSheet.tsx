"use client";

// ปิดงวด (F3) — bottom-sheet มือถือ / dialog เดสก์ท็อป. เลือกบิลที่แท็กโครงการนี้ (ยังไม่ผูกงวด)
// → markInstallmentPaidAction(id,{expenseId}) = เขียว (มีสลิป). หรือปุ่มรอง "จ่ายแล้ว—รอสลิป"
// → markInstallmentPaidAction(id,{}) = amber. ปุ่ม trigger เปิด sheet; server เป็นตัวตัดสินสิทธิ์จริง.
// รูปแบบ bottom-sheet ยืมสำนวนจาก LiffPayeeRequest (ไม่ import) · โครงเดียวกับ kit.

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X, Check, Clock } from "lucide-react";
import {
  markInstallmentPaidAction,
} from "@/app/(admin)/ledger/_actions";
import {
  listLinkableExpensesAction,
  type LinkableExpense,
} from "./_actions";

function baht(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} ฿`;
}

export function MarkPaidSheet({
  installmentId,
  installmentLabel,
  plannedAmount,
  companyId,
  projectId,
}: {
  installmentId: string;
  installmentLabel: string;
  plannedAmount: number;
  companyId: string;
  projectId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<LinkableExpense[]>([]);
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // โหลดบิลตัวเลือกตอนเปิด sheet (ไม่โหลดล่วงหน้าทุกงวด — ประหยัด)
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    setErr(null);
    listLinkableExpensesAction(companyId, projectId)
      .then((r) => {
        if (alive) setRows(r);
      })
      .catch(() => {
        if (alive) setErr("โหลดรายการบิลไม่สำเร็จ");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, companyId, projectId]);

  // ปิดด้วย Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pending]);

  function linkPaid(expenseId: string | null) {
    setErr(null);
    startTransition(async () => {
      const res = await markInstallmentPaidAction(installmentId, expenseId ? { expenseId } : {});
      if (res.ok) {
        setOpen(false);
        setQ("");
        router.refresh();
      } else {
        setErr(res.error ?? "ปิดงวดไม่สำเร็จ");
      }
    });
  }

  const filtered = q.trim()
    ? rows.filter((r) => {
        const s = q.trim().toLowerCase();
        return (
          (r.vendor ?? "").toLowerCase().includes(s) ||
          (r.docCode ?? "").toLowerCase().includes(s)
        );
      })
    : rows;

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setErr(null);
          setOpen(true);
        }}
        className="press inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
      >
        <Check className="size-3.5" aria-hidden /> ปิดงวด
      </button>

      {open && (
        <div
          className="animate-fade-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={() => {
            if (!pending) setOpen(false);
          }}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="ปิดงวด — เลือกบิลจ่ายจริง"
            onClick={(e) => e.stopPropagation()}
          >
            {/* หัว sheet */}
            <div className="flex items-start justify-between gap-2 border-b border-zinc-100 p-4">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-zinc-900">
                  ปิดงวด · {installmentLabel}
                </h3>
                <p className="mt-0.5 text-xs text-zinc-500">
                  ยอดสัญญา {baht(plannedAmount)} — เลือกบิลจ่ายจริง (มีสลิป) หรือมาร์คไว้ก่อน
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                aria-label="ปิด"
                className="press grid size-9 shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 disabled:opacity-50"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            {/* ค้นหา — ไอคอน + input เล็ก (LeanUX · chrome ไม่เด่นเกิน) */}
            <div className="border-b border-zinc-100 px-4 py-2.5">
              <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5">
                <Search className="size-4 shrink-0 text-zinc-400" aria-hidden />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="ค้นหาบิล (ผู้ขาย / เลขที่)"
                  className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none"
                />
                {q && (
                  <button
                    type="button"
                    onClick={() => setQ("")}
                    aria-label="ล้างคำค้น"
                    className="shrink-0 text-zinc-400 hover:text-zinc-600"
                  >
                    <X className="size-4" aria-hidden />
                  </button>
                )}
              </div>
            </div>

            {/* รายการบิล */}
            <div className="min-h-[120px] flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-zinc-500">
                  <Loader2 className="size-4 animate-spin" aria-hidden /> กำลังโหลดบิล…
                </div>
              ) : filtered.length === 0 ? (
                <div className="px-6 py-8 text-center text-sm text-zinc-500">
                  {rows.length === 0
                    ? "ยังไม่มีบิลที่แท็กโครงการนี้ให้เลือก — ติดป้ายโครงการที่หน้ารายจ่ายก่อน แล้วบิลจะมาโผล่ที่นี่"
                    : "ไม่พบบิลตรงคำค้น"}
                </div>
              ) : (
                <ul className="divide-y divide-zinc-100">
                  {filtered.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => linkPaid(r.id)}
                        className="press flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50 disabled:opacity-60"
                      >
                        {/* thumb เล็ก (ไม่ import ReceiptThumb — sheet ต้องการแค่รูปย่อ) */}
                        {r.thumbUrl || r.originalUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={r.thumbUrl || r.originalUrl || ""}
                            alt=""
                            loading="lazy"
                            className="size-11 shrink-0 rounded-lg border border-zinc-200 object-cover"
                          />
                        ) : (
                          <span className="grid size-11 shrink-0 place-items-center rounded-lg border border-dashed border-zinc-200 bg-zinc-50 text-[10px] text-zinc-400">
                            ไม่มีรูป
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-zinc-800">
                            {r.vendor || "ไม่ระบุผู้ขาย"}
                          </span>
                          <span className="block truncate text-xs text-zinc-500">
                            {r.docCode || "—"}
                            {r.wht > 0 ? ` · หัก ณ ที่จ่าย ${baht(r.wht)}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-sm font-semibold tabular-nums text-zinc-900">
                            {baht(r.cashOut)}
                          </span>
                          <span className="block text-[11px] text-zinc-400">จ่ายจริง</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {err && (
              <p className="mx-4 mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {err}
              </p>
            )}

            {/* ปุ่มรอง — จ่ายแล้ว รอสลิป (amber) */}
            <div className="border-t border-zinc-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={() => linkPaid(null)}
                disabled={pending}
                className="press flex w-full items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-60"
              >
                {pending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Clock className="size-4" aria-hidden />
                )}
                จ่ายแล้ว—รอสลิป (แนบทีหลัง)
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
