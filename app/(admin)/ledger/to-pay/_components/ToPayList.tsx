"use client";

// ToPayList — "บิลที่ต้องจ่าย" แบบแบ่งซ้าย/ขวา (master-detail) ตามที่ CEO สั่ง:
//   • ซ้าย  = ลิสต์คำขอโอน (เลื่อนหา · เรียงค้างนานสุด · กดเลือก · คีย์ลัด ↑/↓)
//   • ขวา   = รายละเอียดที่เลือก: โอนไปที่ไหน (บัญชี/QR) + ดูบิลจริง (รูป+รายการ)
//   • มือถือ = แตะแถว → รายละเอียดเต็มจอ + ปุ่ม "← กลับ"
//   • คีย์ลัด (เดสก์ท็อป): ↑/↓ เลื่อนเลือก · Enter/Space/V เปิดรูปบิลเต็มจอ
// อ่านอย่างเดียว — ไม่แตะเงิน/DB/TRCloud (เงินโอนจริง CEO กดผ่านแอปธนาคารเอง).

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, ChevronRight, QrCode } from "lucide-react";
import type { ToPayData, ToPayRow } from "@/lib/ledger/to-pay-queries";
import { BillDetailPane } from "@/components/ledger/BillDetailPane";

function baht(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("th-TH", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
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

// ── แผงผู้รับเงิน (โอนไปที่ไหน) ──
function PayeeBlock({ r }: { r: ToPayRow }) {
  const hasAcct = r.payeeAcctNo || r.payeeAcctName || r.payeeBankName;
  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2 text-sm ring-1 ring-inset ring-zinc-100">
      <div className="text-xs font-medium text-zinc-500">โอนไปที่</div>
      {hasAcct ? (
        <div className="mt-1 space-y-0.5">
          {r.payeeBankName && <div className="text-zinc-700">{r.payeeBankName}</div>}
          {r.payeeAcctNo && (
            <div className="font-mono text-base font-medium tabular-nums text-zinc-900">{r.payeeAcctNo}</div>
          )}
          {r.payeeAcctName && <div className="text-zinc-600">{r.payeeAcctName}</div>}
        </div>
      ) : r.payeePromptpay ? (
        <div className="mt-1">
          <span className="text-xs text-zinc-500">พร้อมเพย์ </span>
          <span className="font-mono text-base font-medium tabular-nums text-zinc-900">{r.payeePromptpay}</span>
        </div>
      ) : (
        <div className="mt-1 text-zinc-400">ไม่มีข้อมูลบัญชีผู้รับ — ดูในบิล/ถามผู้ขอโอน</div>
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
          <span className="inline-flex items-center gap-1 pr-2 text-xs text-zinc-500">
            <QrCode className="h-3.5 w-3.5" /> แตะดูเต็ม
          </span>
        </a>
      )}
    </div>
  );
}

// ── รายละเอียดคำขอที่เลือก (ใช้ทั้งเดสก์ท็อปฝั่งขวา + มือถือเต็มจอ) ──
function ToPayDetail({
  r,
  companyId,
  onBack,
}: {
  r: ToPayRow;
  companyId: string;
  onBack: () => void;
}) {
  // billIdx เป็น state ในลูก + parent ใส่ key={r.id} → เปลี่ยนคำขอ = remount รีเซ็ตเอง
  // (เลี่ยง setState-in-effect ที่เป็น bug-class เดิม).
  const [billIdx, setBillIdx] = useState(0);
  const age = agePill(r.daysWaiting);
  const bill = r.bills[billIdx] ?? r.bills[0];

  return (
    <div className="space-y-3">
      {/* มือถือ: ปุ่มกลับ */}
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1 text-sm font-medium text-zinc-600 lg:hidden"
      >
        <ArrowLeft className="size-4" /> กลับไปรายการ
      </button>

      {/* หัว */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-base font-semibold text-zinc-900">{r.vendor || "ไม่ระบุผู้ขาย"}</span>
            {r.state === "partial" && (
              <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-inset ring-sky-200">
                จ่ายบางส่วน
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
            <span className={`rounded-full px-1.5 py-0.5 ring-1 ring-inset ${age.cls}`}>{age.text}</span>
            <span>·</span>
            <span>ขอโอน {fmtDate(r.requestedAt)}</span>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xl font-semibold tabular-nums text-zinc-900">฿{baht(r.remaining)}</div>
          <div className="text-[11px] text-zinc-400">ยอดที่ต้องโอน</div>
          {r.state === "partial" && r.paidTotal > 0 && (
            <div className="text-[11px] text-zinc-400">
              จ่ายแล้ว ฿{baht(r.paidTotal)} / ฿{baht(r.expectedTransfer)}
            </div>
          )}
        </div>
      </div>

      {r.dup && (
        <div className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <b>อาจซ้ำ</b> — ผู้ขายและยอดเท่ากันกับ: {dupText(r.dup)} · เช็คก่อนโอนอีกครั้ง
          </span>
        </div>
      )}

      <PayeeBlock r={r} />

      {r.whtTotal > 0 && (
        <div className="text-xs text-zinc-500">
          หัก ณ ที่จ่าย ฿{baht(r.whtTotal)} · ยอดโอนสุทธิ ฿{baht(r.remaining)}
        </div>
      )}

      {/* บิลในคำขอ — เลือกใบ (ถ้ามีหลายใบ) แล้วดูรูป+รายการจริง */}
      <div>
        <div className="mb-1.5 text-[11px] font-medium text-zinc-500">
          บิลในคำขอนี้ ({r.bills.length}) — กดดูรูป/รายการจริง
        </div>
        {r.bills.length > 1 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {r.bills.map((b, i) => (
              <button
                key={b.expenseId}
                type="button"
                onClick={() => setBillIdx(i)}
                className={
                  "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition-colors " +
                  (i === billIdx
                    ? "border-[var(--color-brand-300,#93C5FD)] bg-[var(--color-brand-50,#EFF6FF)] text-[var(--color-brand-700,#1D4ED8)]"
                    : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50")
                }
              >
                <span className="font-mono">{b.docCode}</span>
                <span className="tabular-nums text-zinc-400">฿{baht(b.amount)}</span>
              </button>
            ))}
          </div>
        )}
        {bill && (
          <BillDetailPane key={bill.expenseId} expenseId={bill.expenseId} companyId={companyId} />
        )}
      </div>
    </div>
  );
}

export function ToPayList({ data, companyId }: { data: ToPayData; companyId: string }) {
  const rows = data.rows;
  const [selId, setSelId] = useState<string | null>(rows[0]?.id ?? null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const detailRef = useRef<HTMLDivElement>(null);

  const sel = rows.find((r) => r.id === selId) ?? null;

  // เลื่อนแถวที่เลือกให้เห็น (หลังคีย์ลัด)
  useEffect(() => {
    if (selId) rowRefs.current.get(selId)?.scrollIntoView({ block: "nearest" });
  }, [selId]);

  function selectRow(id: string) {
    setSelId(id);
    setMobileDetail(true);
  }
  function move(delta: number) {
    if (rows.length === 0) return;
    const idx = rows.findIndex((r) => r.id === selId);
    const ni = ((idx < 0 ? 0 : idx) + delta + rows.length) % rows.length;
    setSelId(rows[ni].id);
    rowRefs.current.get(rows[ni].id)?.focus();
  }
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if ((e.key === "Enter" || e.key === " " || e.key === "v" || e.key === "V") && sel) {
      e.preventDefault();
      // เปิดรูปบิลเต็มจอ = คลิกปุ่มขยายในแผงรายละเอียด (DOM action · ไม่ใช้ signal/effect)
      detailRef.current?.querySelector<HTMLButtonElement>("[data-bill-zoom]")?.click();
    }
  }

  if (data.count === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-200 py-16 text-center text-sm text-zinc-500">
        ไม่มีบิลที่ต้องจ่ายตอนนี้ 🎉
      </div>
    );
  }

  return (
    <div className="space-y-3" onKeyDown={onKeyDown}>
      {/* แถบสรุปยอดรวม */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-zinc-900 px-4 py-3 text-white">
        <span className="text-sm text-zinc-300">ต้องโอนทั้งหมด · {data.count} รายการ</span>
        <span className="text-2xl font-semibold tabular-nums">฿{baht(data.totalRemaining)}</span>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(300px,380px)_1fr] lg:gap-4">
        {/* ซ้าย: ลิสต์ */}
        <div className={(mobileDetail ? "hidden" : "block") + " lg:block"}>
          <ul className="space-y-1.5">
            {rows.map((r) => {
              const age = agePill(r.daysWaiting);
              const active = r.id === selId;
              return (
                <li key={r.id}>
                  <button
                    ref={(el) => {
                      if (el) rowRefs.current.set(r.id, el);
                      else rowRefs.current.delete(r.id);
                    }}
                    type="button"
                    onClick={() => selectRow(r.id)}
                    aria-current={active}
                    className={
                      "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors " +
                      (active
                        ? "border-[var(--color-brand-300,#93C5FD)] bg-[var(--color-brand-50,#EFF6FF)] ring-1 ring-[var(--color-brand-200,#BFDBFE)]"
                        : "border-zinc-200 bg-white hover:bg-zinc-50")
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-zinc-900">
                          {r.vendor || "ไม่ระบุผู้ขาย"}
                        </span>
                        {r.state === "partial" && (
                          <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 ring-1 ring-inset ring-sky-200">
                            บางส่วน
                          </span>
                        )}
                        {r.dup && (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700 ring-1 ring-inset ring-red-200">
                            <AlertTriangle className="h-2.5 w-2.5" /> อาจซ้ำ
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400">
                        <span>{r.bills.length} บิล</span>
                        <span>·</span>
                        <span className={`rounded-full px-1.5 py-0.5 ring-1 ring-inset ${age.cls}`}>{age.text}</span>
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold tabular-nums text-zinc-900">฿{baht(r.remaining)}</div>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-zinc-300 lg:hidden" />
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 hidden px-1 text-[11px] text-zinc-400 lg:block">
            คีย์ลัด: ↑/↓ เลื่อน · Enter เปิดรูปบิล
          </p>
        </div>

        {/* ขวา: รายละเอียด (เดสก์ท็อปเห็นเสมอ · มือถือเห็นเมื่อแตะแถว) */}
        <div ref={detailRef} className={(mobileDetail ? "block" : "hidden") + " lg:block"}>
          {sel ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-3 sm:p-4">
              <ToPayDetail
                key={sel.id}
                r={sel}
                companyId={companyId}
                onBack={() => setMobileDetail(false)}
              />
            </div>
          ) : (
            <div className="hidden rounded-xl border border-dashed border-zinc-200 py-16 text-center text-sm text-zinc-400 lg:block">
              เลือกบิลจากรายการเพื่อดูรายละเอียด
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
