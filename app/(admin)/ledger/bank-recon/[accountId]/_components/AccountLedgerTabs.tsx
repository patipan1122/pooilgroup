"use client";

// AccountLedgerTabs — PEAK "ภาพรวมเงินเข้า-เงินออก": รายการบันทึก / รายการเคลื่อนไหว.
// Book rows link to the document detail (expense review pane / revenue manager).

import { useState } from "react";
import Link from "next/link";
import { CheckCircle, Clock } from "lucide-react";

interface BankRow {
  id: string; date: string; description: string; txnType: string; channel: string | null; ref1: string | null;
  amountSatang: number; balanceSatang: number; matchState: string;
}
interface BookRow {
  bookId: string; bookType: string; date: string; docNo: string;
  contact: string; detail: string; kind: string; amountSatang: number; reconciled: boolean;
}
interface Props {
  bankLedger: BankRow[];
  bookLedger: BookRow[];
  companyId: string;
}

function baht(s: number) {
  return (Math.abs(s) / 100).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const BOOK_TAG: Record<string, string> = { revenue: "รายได้", expense: "ค่าใช้จ่าย", payment: "จ่ายเงิน" };

function StateBadge({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
      <CheckCircle size={10} /> กระทบยอดแล้ว
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
      <Clock size={10} /> รอกระทบยอด
    </span>
  );
}

export function AccountLedgerTabs({ bankLedger, bookLedger, companyId }: Props) {
  const [tab, setTab] = useState<"book" | "bank">("bank");

  return (
    <div className="rounded-2xl border border-zinc-100 bg-white">
      <div className="flex gap-1 border-b border-zinc-100 px-3 pt-3">
        <button
          type="button"
          onClick={() => setTab("book")}
          className={`rounded-t-lg px-4 py-2 text-sm font-medium ${tab === "book" ? "border-b-2 border-blue-600 text-blue-700" : "text-zinc-500"}`}
        >
          รายการบันทึกบัญชี <span className="text-xs text-zinc-400">({bookLedger.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("bank")}
          className={`rounded-t-lg px-4 py-2 text-sm font-medium ${tab === "bank" ? "border-b-2 border-blue-600 text-blue-700" : "text-zinc-500"}`}
        >
          รายการเคลื่อนไหว (ธนาคาร) <span className="text-xs text-zinc-400">({bankLedger.length})</span>
        </button>
      </div>

      {tab === "bank" ? (
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-left text-xs font-medium text-zinc-500">
              <tr>
                <th className="px-4 py-2.5">วันที่</th>
                <th className="px-4 py-2.5">รายละเอียด</th>
                <th className="px-4 py-2.5 text-right">เงินเข้า-ออก</th>
                <th className="px-4 py-2.5 text-right">คงเหลือ</th>
                <th className="px-4 py-2.5 text-center">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {bankLedger.map((r) => {
                const credit = r.amountSatang > 0;
                return (
                  <tr key={r.id} className="hover:bg-zinc-50">
                    <td className="whitespace-nowrap px-4 py-2.5 text-zinc-500 align-top">{r.date}</td>
                    <td className="px-4 py-2.5 align-top max-w-[360px]">
                      <p className="truncate text-zinc-700">{r.description || "—"}</p>
                      <p className="truncate text-xs text-zinc-400">
                        {[r.txnType, r.channel, r.ref1].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </td>
                    <td className={`whitespace-nowrap px-4 py-2.5 text-right font-semibold ${credit ? "text-emerald-600" : "text-rose-600"}`}>
                      {credit ? "+" : "−"}฿{baht(r.amountSatang)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-zinc-500">฿{baht(r.balanceSatang)}</td>
                    <td className="px-4 py-2.5 text-center"><StateBadge ok={r.matchState === "confirmed" || r.matchState === "excluded"} /></td>
                  </tr>
                );
              })}
              {bankLedger.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-zinc-400">ยังไม่มีรายการเคลื่อนไหวในงวดนี้ — นำเข้า statement ก่อน</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-zinc-50 text-left text-xs font-medium text-zinc-500">
              <tr>
                <th className="px-4 py-2.5">วันที่</th>
                <th className="px-4 py-2.5">เอกสาร</th>
                <th className="px-4 py-2.5">ผู้ติดต่อ</th>
                <th className="px-4 py-2.5 text-right">จำนวนเงิน</th>
                <th className="px-4 py-2.5 text-center">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {bookLedger.map((r) => {
                const credit = r.amountSatang > 0;
                const href = r.bookType === "expense"
                  ? `/ledger/expenses?selected=${r.bookId}`
                  : r.bookType === "revenue"
                  ? `/ledger/bank-recon/revenue?company=${companyId}`
                  : null;
                const docCell = (
                  <span className="inline-flex items-center gap-1.5">
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">{BOOK_TAG[r.bookType] ?? r.bookType}</span>
                    <span className={href ? "text-blue-600 hover:underline" : "text-zinc-700"}>{r.docNo || "—"}</span>
                  </span>
                );
                return (
                  <tr key={`${r.bookType}:${r.bookId}`} className="hover:bg-zinc-50">
                    <td className="whitespace-nowrap px-4 py-2.5 text-zinc-500 align-top">{r.date}</td>
                    <td className="px-4 py-2.5 align-top">{href ? <Link href={href}>{docCell}</Link> : docCell}</td>
                    <td className="px-4 py-2.5 align-top max-w-[260px]">
                      <p className="truncate text-zinc-600">{r.contact || "—"}</p>
                      {r.detail && <p className="truncate text-xs text-zinc-400">{r.detail}</p>}
                    </td>
                    <td className={`whitespace-nowrap px-4 py-2.5 text-right font-semibold ${credit ? "text-emerald-600" : "text-rose-600"}`}>
                      {credit ? "+" : "−"}฿{baht(r.amountSatang)}
                    </td>
                    <td className="px-4 py-2.5 text-center"><StateBadge ok={r.reconciled} /></td>
                  </tr>
                );
              })}
              {bookLedger.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-zinc-400">ยังไม่มีรายการบันทึกบัญชีในงวดนี้</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
