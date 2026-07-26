import { AlertTriangle, ChevronDown, QrCode } from "lucide-react";
import type { ToPayData, ToPayRow } from "@/lib/ledger/to-pay-queries";

function baht(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

// ค้างกี่วัน → สี (ยิ่งนาน ยิ่งควรจ่ายก่อน)
function agePill(days: number): { text: string; cls: string } {
  const text = days === 0 ? "วันนี้" : `ค้าง ${days} วัน`;
  if (days >= 8) return { text, cls: "bg-red-50 text-red-700 ring-red-200" };
  if (days >= 4) return { text, cls: "bg-amber-50 text-amber-700 ring-amber-200" };
  return { text, cls: "bg-zinc-100 text-zinc-500 ring-zinc-200" };
}

function dupText(dup: NonNullable<ToPayRow["dup"]>): string {
  const parts: string[] = [];
  if (dup.otherOpenCount > 0) parts.push(`ยังรอโอนอีก ${dup.otherOpenCount} ใบ`);
  if (dup.paidRecently) {
    const d = fmtDate(dup.paidRecently.when);
    parts.push(`จ่ายไปแล้วเมื่อ ${d}${dup.paidRecently.docCode ? ` (${dup.paidRecently.docCode})` : ""}`);
  }
  return parts.join(" · ");
}

export function ToPayList({ data }: { data: ToPayData }) {
  if (data.count === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-200 py-16 text-center text-sm text-zinc-500">
        ไม่มีบิลที่ต้องจ่ายตอนนี้ 🎉
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* แถบสรุปยอดรวม */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-zinc-900 px-4 py-3 text-white">
        <span className="text-sm text-zinc-300">ต้องโอนทั้งหมด · {data.count} รายการ</span>
        <span className="text-2xl font-semibold tabular-nums">฿{baht(data.totalRemaining)}</span>
      </div>

      {/* รายการบิล */}
      <div className="space-y-2">
        {data.rows.map((r) => {
          const age = agePill(r.daysWaiting);
          return (
            <details key={r.id} className="group overflow-hidden rounded-xl border border-zinc-200 bg-white">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-zinc-50">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium text-zinc-900">{r.vendor || "ไม่ระบุผู้ขาย"}</span>
                    {r.state === "partial" && (
                      <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-inset ring-sky-200">
                        จ่ายบางส่วน
                      </span>
                    )}
                    {r.dup && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-200">
                        <AlertTriangle className="h-3 w-3" /> อาจซ้ำ
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-400">
                    <span>{r.bills.length} บิล</span>
                    <span>·</span>
                    <span className={`rounded-full px-1.5 py-0.5 ring-1 ring-inset ${age.cls}`}>{age.text}</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-lg font-semibold tabular-nums text-zinc-900">฿{baht(r.remaining)}</div>
                  {r.state === "partial" && r.paidTotal > 0 && (
                    <div className="text-[11px] text-zinc-400">จ่ายแล้ว ฿{baht(r.paidTotal)} / ฿{baht(r.expectedTransfer)}</div>
                  )}
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 text-zinc-300 transition-transform group-open:rotate-180" />
              </summary>

              {/* กางดู: ข้อมูลโอน + เตือนซ้ำ + บิล */}
              <div className="space-y-3 border-t border-zinc-100 px-4 py-3">
                {r.dup && (
                  <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      <b>อาจซ้ำ</b> — ผู้ขายและยอดเท่ากันกับ: {dupText(r.dup)} · เช็คก่อนโอนอีกครั้ง
                    </span>
                  </div>
                )}

                {/* ผู้รับเงิน */}
                <div className="rounded-lg bg-zinc-50 px-3 py-2 text-sm ring-1 ring-inset ring-zinc-100">
                  <div className="text-xs font-medium text-zinc-500">โอนไปที่</div>
                  {r.payeeAcctNo || r.payeeAcctName || r.payeeBankName ? (
                    <div className="mt-1 space-y-0.5">
                      {r.payeeBankName && <div className="text-zinc-700">{r.payeeBankName}</div>}
                      {r.payeeAcctNo && <div className="font-mono text-base font-medium tabular-nums text-zinc-900">{r.payeeAcctNo}</div>}
                      {r.payeeAcctName && <div className="text-zinc-600">{r.payeeAcctName}</div>}
                    </div>
                  ) : r.payeePromptpay ? (
                    <div className="mt-1">
                      <span className="text-xs text-zinc-500">พร้อมเพย์ </span>
                      <span className="font-mono text-base font-medium tabular-nums text-zinc-900">{r.payeePromptpay}</span>
                    </div>
                  ) : (
                    <div className="mt-1 text-zinc-400">ไม่มีข้อมูลบัญชีผู้รับ — ดูในใบ/ถามผู้ขอโอน</div>
                  )}
                  {r.payeeQrImageUrl && (
                    <a
                      href={r.payeeQrImageUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-1.5 hover:bg-zinc-50"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={r.payeeQrImageUrl} alt="QR ผู้รับ" className="h-24 w-24 rounded object-contain" />
                      <span className="inline-flex items-center gap-1 pr-2 text-xs text-zinc-500"><QrCode className="h-3.5 w-3.5" /> แตะดูเต็ม</span>
                    </a>
                  )}
                </div>

                {/* บิลในคำขอ */}
                <div>
                  <div className="mb-1 text-xs font-medium text-zinc-500">บิลในคำขอนี้ ({r.bills.length})</div>
                  <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-100">
                    {r.bills.map((b, i) => (
                      <div key={i} className="flex items-center justify-between px-2.5 py-1.5 text-sm">
                        <span className="text-zinc-600">{b.docCode}</span>
                        <span className="tabular-nums text-zinc-700">฿{baht(b.amount)}</span>
                      </div>
                    ))}
                  </div>
                  {r.whtTotal > 0 && (
                    <div className="mt-1.5 text-xs text-zinc-400">
                      หัก ณ ที่จ่าย ฿{baht(r.whtTotal)} · ยอดโอนสุทธิ ฿{baht(r.remaining)}
                    </div>
                  )}
                  <div className="mt-1.5 text-xs text-zinc-400">ขอโอนเมื่อ {fmtDate(r.requestedAt)}</div>
                </div>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
