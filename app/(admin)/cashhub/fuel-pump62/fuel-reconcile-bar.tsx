"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Send,
  Eye,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Building2,
} from "lucide-react";
import {
  previewFuelReconcile,
  sendFuelReconcile,
  type FuelReconcilePreview,
} from "./actions";
import type { FuelMonthMeta } from "./fuel-sheet-view";

const fmt = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function FuelReconcileBar({ months }: { months: FuelMonthMeta[] }) {
  const router = useRouter();
  const [sel, setSel] = useState(months[0]?.period_key ?? "");
  const [preview, setPreview] = useState<FuelReconcilePreview | null>(null);
  const [showDays, setShowDays] = useState(false);
  const [loading, startLoad] = useTransition();
  const [sending, startSend] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (months.length === 0) return null;

  function loadPreview() {
    setMsg(null);
    startLoad(async () => {
      const p = await previewFuelReconcile(sel);
      setPreview(p);
      setShowDays(false);
    });
  }

  function doSend() {
    if (!preview?.ok) return;
    setMsg(null);
    startSend(async () => {
      const r = await sendFuelReconcile([sel]);
      if (r.ok) {
        setMsg({
          ok: true,
          text: `ส่งเข้ากระทบยอดแล้ว ${r.inserted ?? 0} รายการ${
            r.skipped ? ` · ข้าม ${r.skipped} (ยังไม่ตั้งบัญชี/บริษัท)` : ""
          }`,
        });
        const p = await previewFuelReconcile(sel);
        setPreview(p);
        router.refresh();
      } else {
        setMsg({ ok: false, text: r.error ?? "ส่งไม่สำเร็จ" });
      }
    });
  }

  const channels = preview?.ok ? preview.channels ?? [] : [];
  const anyWillSend = channels.some((c) => c.willSend);

  return (
    <div className="rounded-2xl border border-[var(--ch-border)] bg-[var(--ch-bg-2)] p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-bold text-[var(--ch-text)]">
            💸 ส่งเข้ากระทบยอด (ระบบบัญชี)
          </span>
          <span className="text-xs text-[var(--ch-text-2)]">
            เงินเข้าจริง → บัญชี TTB · กดดูยอดก่อนส่ง (ตรวจ &ldquo;เป๊ะ&rdquo;) แล้วค่อยส่ง
          </span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            value={sel}
            onChange={(e) => {
              setSel(e.target.value);
              setPreview(null);
            }}
            disabled={loading || sending}
            className="rounded-lg border border-[var(--ch-border)] bg-white px-2.5 py-1.5 text-xs font-medium text-[var(--ch-text)]"
            aria-label="เลือกเดือน"
          >
            {months.map((m) => (
              <option key={m.period_key} value={m.period_key}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={loading || sending || !sel}
            onClick={loadPreview}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ch-border)] bg-white px-3 py-2 text-xs font-semibold text-[var(--ch-text)] hover:border-[var(--ch-brand)] disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Eye className="size-3.5" />
            )}
            ดูยอดที่จะส่ง
          </button>
        </div>
      </div>

      {/* พรีวิว */}
      {preview && !preview.ok && (
        <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
          <AlertTriangle className="size-3.5" /> {preview.error}
        </div>
      )}

      {preview?.ok && (
        <div className="mt-3 space-y-3">
          {/* สรุปต่อช่องทาง */}
          <div className="overflow-x-auto rounded-xl border border-[var(--ch-border)] bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--ch-border)] bg-zinc-50 text-left text-xs text-zinc-500">
                  <th className="p-2.5">ช่องเงินเข้า</th>
                  <th className="p-2.5">ดึงจากคอลัมน์</th>
                  <th className="p-2.5">เข้าบัญชี</th>
                  <th className="p-2.5 text-right">ยอดรวมเดือนนี้</th>
                  <th className="p-2.5 text-center">วัน</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.code} className="border-b border-zinc-100 last:border-0">
                    <td className="p-2.5 font-medium text-zinc-700">{c.label}</td>
                    <td className="p-2.5 text-xs text-zinc-500">
                      {c.headerNames.length ? (
                        c.headerNames.join(" + ")
                      ) : (
                        <span className="text-amber-600">ไม่พบในชีต</span>
                      )}
                    </td>
                    <td className="p-2.5 text-xs">
                      {c.accountLabel ? (
                        <span className="text-emerald-700">{c.accountLabel}</span>
                      ) : (
                        <span className="text-amber-600">— ยังไม่ตั้ง</span>
                      )}
                    </td>
                    <td className="p-2.5 text-right tabular-nums font-semibold text-zinc-800">
                      {fmt(c.total)}
                    </td>
                    <td className="p-2.5 text-center">
                      {c.willSend ? (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          <CheckCircle2 className="size-3" /> {c.daysWithAmount}
                        </span>
                      ) : (
                        <span
                          title={c.warn ?? ""}
                          className="inline-flex items-center gap-0.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700"
                        >
                          <AlertTriangle className="size-3" /> {c.warn}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-zinc-50 text-sm font-bold">
                  <td className="p-2.5" colSpan={3}>
                    รวมที่จะส่ง — {preview.periodLabel}
                  </td>
                  <td className="p-2.5 text-right tabular-nums text-[var(--ch-brand)]">
                    {fmt(preview.grandTotal ?? 0)}
                  </td>
                  <td className="p-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* รายวัน (ยุบได้) */}
          {(preview.days?.length ?? 0) > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowDays((s) => !s)}
                className="text-xs font-medium text-[var(--ch-brand)] hover:underline"
              >
                {showDays ? "ซ่อนรายวัน" : `ดูรายวัน (${preview.days?.length} วัน)`}
              </button>
              {showDays && (
                <div className="mt-2 max-h-[40vh] overflow-auto rounded-xl border border-[var(--ch-border)] bg-white">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-zinc-50">
                      <tr className="text-left text-zinc-500">
                        <th className="p-2">วันที่</th>
                        <th className="p-2">ช่อง</th>
                        <th className="p-2 text-right">ยอด</th>
                        <th className="p-2 text-center">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.days?.flatMap((d) =>
                        d.cells.map((cell) => (
                          <tr
                            key={`${d.date}:${cell.code}`}
                            className="border-b border-zinc-100 last:border-0"
                          >
                            <td className="p-2 text-zinc-500">{d.date}</td>
                            <td className="p-2 text-zinc-700">
                              {channels.find((c) => c.code === cell.code)?.label ?? cell.code}
                            </td>
                            <td className="p-2 text-right tabular-nums">{fmt(cell.amount)}</td>
                            <td className="p-2 text-center">
                              {cell.state === "reconciled" ? (
                                <span className="text-emerald-600">🟢 กระทบแล้ว</span>
                              ) : cell.state === "pending" ? (
                                <span className="text-blue-600">🔵 ส่งแล้ว</span>
                              ) : (
                                <span className="text-zinc-400">⚪ ยังไม่ส่ง</span>
                              )}
                            </td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ปุ่มส่ง */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={sending || loading || !anyWillSend}
              onClick={doSend}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--ch-brand)] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-40"
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              ส่งเข้ากระทบยอด
            </button>
            {!anyWillSend && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                <Building2 className="size-3.5" /> ยังไม่มีช่องที่พร้อมส่ง — ตั้งบัญชี/บริษัทที่
                ⚙️ ตั้งค่าช่องทาง ก่อน
              </span>
            )}
          </div>
        </div>
      )}

      {msg && (
        <div
          className={`mt-3 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium ${
            msg.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {msg.ok ? (
            <CheckCircle2 className="size-3.5" />
          ) : (
            <AlertTriangle className="size-3.5" />
          )}
          {msg.text}
        </div>
      )}
    </div>
  );
}
