// SlipEvidence — แสดง "สลิปโอนเงิน" ที่จับคู่กับบิลแล้วในใบรายละเอียด (โอนแล้ว).
// เดิมช่องนี้เป็นกล่องว่าง "แนบอัตโนมัติจากกลุ่มขอโอน" + ลิงก์ไปหน้ากระทบยอด → คนขอโอน
// เปิดใบแล้วไม่เห็นสลิป เอาไปส่งต่อผู้ขายไม่ได้ (CEO 2026-06-11). ตอนนี้โชว์รูปสลิปจริง
// (กดขยาย/เปิดต้นฉบับผ่าน ReceiptThumb) + ปุ่มดาวน์โหลด + ปุ่มส่งต่อ (แชร์ของเครื่อง →
// ส่งเข้าแชต/แอปไหนก็ได้ · บนเครื่องที่ไม่มี share = คัดลอกลิงก์).
"use client";

import { useState } from "react";
import { Download, Share2, Check } from "lucide-react";
import { ReceiptThumb } from "./ReceiptThumb";
import type { ExpenseSlip } from "@/lib/ledger/types";

export function SlipEvidence({ slip }: { slip: ExpenseSlip }) {
  const url = slip.slipUrl || slip.slipThumbUrl;
  const [copied, setCopied] = useState(false);
  if (!url) return null;

  async function share() {
    // มือถือ/LIFF: เปิดแผงแชร์ของเครื่อง → ส่งสลิปต่อให้ผู้ขายผ่าน LINE/แอปอื่นได้.
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title: "สลิปโอนเงิน", text: "สลิปโอนเงิน", url: url! });
        return;
      }
    } catch {
      // ผู้ใช้กดยกเลิก หรือเครื่องไม่รองรับ → ตกไปคัดลอกลิงก์แทน
    }
    try {
      await navigator.clipboard.writeText(url!);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.open(url!, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <div className="space-y-1.5">
      <ReceiptThumb thumbUrl={slip.slipThumbUrl} originalUrl={slip.slipUrl} alt="สลิปโอนเงิน" />
      <div className="grid grid-cols-2 gap-1.5">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          download
          className="press flex items-center justify-center gap-1 rounded-lg border border-zinc-200 px-2 py-1.5 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50"
        >
          <Download className="size-3.5 text-zinc-500" aria-hidden /> ดาวน์โหลด
        </a>
        <button
          type="button"
          onClick={share}
          className="press flex items-center justify-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] font-medium text-emerald-800 hover:bg-emerald-100"
        >
          {copied ? (
            <>
              <Check className="size-3.5" aria-hidden /> คัดลอกลิงก์แล้ว
            </>
          ) : (
            <>
              <Share2 className="size-3.5" aria-hidden /> ส่งต่อ
            </>
          )}
        </button>
      </div>
      {slip.transRef && (
        <p className="text-[10px] text-zinc-400">อ้างอิงสลิป: {slip.transRef}</p>
      )}
    </div>
  );
}
