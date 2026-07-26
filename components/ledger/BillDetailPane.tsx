"use client";

// BillDetailPane — แผง "ดูบิลจริง" อ่านอย่างเดียว ใช้ร่วมกันทั้ง /ledger/to-pay และ
// /ledger/reconcile. รับ expenseId → โหลดไส้ในบิล (getBillDetailAction) ตอนเปิด
// เท่านั้น (ไม่ preload ทั้งลิสต์) → โชว์: รูปใบเสร็จ (กดขยายเต็มจอ) + รายการสินค้า +
// เลขที่เอกสาร + ยอด/VAT/หัก ณ ที่จ่าย + ปุ่มเปิดใบเต็ม. ทำให้ CEO "กดดูก่อนแมช/ก่อนโอน"
// ได้จริง แทนที่จะเห็นแค่เลข EXP เปล่า ๆ.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ExternalLink,
  FileText,
  ImageOff,
  Loader2,
  Maximize2,
  ReceiptText,
  X,
} from "lucide-react";
import {
  getBillDetailAction,
  type BillDetail,
} from "@/app/(admin)/ledger/_bill-detail-action";

const baht = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DOC_TYPE_LABEL: Record<string, string> = {
  tax_invoice: "ใบกำกับภาษี",
  receipt: "ใบเสร็จรับเงิน",
  cash_bill: "บิลเงินสด",
  delivery_note: "ใบส่งของ",
  quotation: "ใบเสนอราคา",
  other: "อื่น ๆ",
};

const IMG_KIND_LABEL: Record<string, string> = {
  receipt: "ใบเสร็จ",
  po: "ใบสั่งซื้อ",
  evidence: "หลักฐาน",
  page: "หน้าเพิ่ม",
};

function fmtThaiDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
}

// ── Lightbox (zoom เต็มจอ) — createPortal ออกนอก stacking context (D-008) ──
function Lightbox({
  images,
  index,
  onClose,
  onIndex,
}: {
  images: BillDetail["images"];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && images.length > 1)
        onIndex((index + 1) % images.length);
      else if (e.key === "ArrowLeft" && images.length > 1)
        onIndex((index - 1 + images.length) % images.length);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [index, images.length, onClose, onIndex]);

  // Lightbox เปิดจากการคลิกฝั่ง client เท่านั้น → document พร้อมเสมอ (guard SSR แบบไม่ใช้ effect).
  if (typeof document === "undefined") return null;
  const img = images[index];
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex flex-col bg-black/90"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="รูปบิลขยายเต็มจอ"
    >
      <div className="flex shrink-0 items-center justify-between px-4 py-3 text-white">
        <span className="text-sm">
          {IMG_KIND_LABEL[img.kind] ?? "รูป"}
          {images.length > 1 ? ` · ${index + 1}/${images.length}` : ""}
        </span>
        <div className="flex items-center gap-3">
          <a
            href={img.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-xs text-white/80 hover:text-white"
          >
            <ExternalLink className="size-3.5" /> แท็บใหม่
          </a>
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            className="rounded-full p-1 text-white/80 hover:bg-white/10 hover:text-white"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-2 pb-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={img.url}
          alt="บิลขยาย"
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full rounded-lg object-contain"
        />
      </div>
      {images.length > 1 && (
        <div
          className="flex shrink-0 items-center justify-center gap-2 pb-4"
          onClick={(e) => e.stopPropagation()}
        >
          {images.map((im, i) => (
            <button
              key={im.url}
              type="button"
              onClick={() => onIndex(i)}
              aria-label={`รูปที่ ${i + 1}`}
              className={
                "h-2 rounded-full transition-all " +
                (i === index ? "w-6 bg-white" : "w-2 bg-white/40 hover:bg-white/70")
              }
            />
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

export function BillDetailPane({
  expenseId,
  companyId,
  className = "",
}: {
  expenseId: string;
  companyId: string;
  className?: string;
}) {
  const [bill, setBill] = useState<BillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [imgIdx, setImgIdx] = useState(0);
  const [zoom, setZoom] = useState(false);

  // โหลดไส้ในบิลตอน expenseId เปลี่ยน — setState อยู่ใน async IIFE (ตาม pattern ที่โปรเจกต์
  // ใช้ · เลี่ยง set-state-in-effect). คีย์ลัด "เปิดรูป" จากลิสต์แม่ = คลิกปุ่ม [data-bill-zoom].
  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      setErr(null);
      setBill(null);
      setImgIdx(0);
      try {
        const res = await getBillDetailAction({ expenseId, companyId });
        if (!alive) return;
        if (res.ok) setBill(res.bill);
        else setErr(res.error);
      } catch {
        if (alive) setErr("โหลดบิลไม่สำเร็จ");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [expenseId, companyId]);

  const openZoom = useCallback(() => setZoom(true), []);

  if (loading) {
    return (
      <div className={"flex items-center justify-center gap-2 py-10 text-sm text-zinc-400 " + className}>
        <Loader2 className="size-4 animate-spin" /> กำลังโหลดบิล…
      </div>
    );
  }
  if (err || !bill) {
    return (
      <div className={"rounded-xl border border-dashed border-zinc-200 bg-zinc-50 px-4 py-8 text-center text-sm text-zinc-500 " + className}>
        {err ?? "ไม่พบบิล"}
      </div>
    );
  }

  const mainImg = bill.images[imgIdx];

  return (
    <div className={"space-y-3 " + className}>
      {/* รูปใบเสร็จ — กดเพื่อขยายเต็มจอ */}
      <div>
        {mainImg ? (
          <button
            type="button"
            onClick={openZoom}
            data-bill-zoom
            className="group relative block w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50"
            aria-label="กดเพื่อขยายรูปบิล"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mainImg.url}
              alt={`บิล ${bill.docCode}`}
              className="mx-auto max-h-[300px] w-auto max-w-full cursor-zoom-in object-contain sm:max-h-[380px]"
            />
            <span className="pointer-events-none absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium text-white opacity-90">
              <Maximize2 className="size-3" /> กดขยาย
            </span>
          </button>
        ) : (
          <div className="grid h-40 place-items-center rounded-xl border border-dashed border-zinc-200 bg-zinc-50 text-zinc-300">
            <div className="flex flex-col items-center gap-1 text-xs text-zinc-400">
              <ImageOff className="size-5" /> ไม่มีรูปบิล
            </div>
          </div>
        )}
        {/* thumbnail strip เมื่อมีหลายรูป (บิลหลายหน้า/PO/หลักฐาน) */}
        {bill.images.length > 1 && (
          <div className="mt-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {bill.images.map((im, i) => (
              <button
                key={im.url}
                type="button"
                onClick={() => setImgIdx(i)}
                className={
                  "relative size-12 shrink-0 overflow-hidden rounded-lg border-2 " +
                  (i === imgIdx ? "border-[var(--color-brand-500,#2563EB)]" : "border-zinc-200")
                }
                aria-label={`${IMG_KIND_LABEL[im.kind] ?? "รูป"} ${i + 1}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={im.url} alt="" className="size-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* หัวบิล */}
      <div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold text-zinc-900">{bill.vendor || "ไม่ระบุผู้ขาย"}</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">
            <FileText className="size-3" /> {DOC_TYPE_LABEL[bill.docType] ?? bill.docType}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
          <span className="font-mono text-zinc-600">{bill.docCode}</span>
          {bill.vendorDocNumber && <span>เลขที่ {bill.vendorDocNumber}</span>}
          <span>{fmtThaiDate(bill.docDate)}</span>
          {bill.categoryName && (
            <span className="inline-flex items-center gap-1">
              <span className="size-1.5 rounded-full bg-zinc-300" /> {bill.categoryName}
            </span>
          )}
        </div>
      </div>

      {/* รายการสินค้า */}
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
          <ReceiptText className="size-3.5" /> รายการในบิล ({bill.items.length})
        </div>
        {bill.items.length === 0 ? (
          <div className="rounded-lg border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-400">
            ไม่มีรายการย่อย — ดูยอดรวมด้านล่าง
          </div>
        ) : (
          <div className="divide-y divide-zinc-100 rounded-lg border border-zinc-100">
            {bill.items.map((it, i) => (
              <div key={i} className="flex items-start justify-between gap-2 px-2.5 py-1.5 text-xs">
                <div className="min-w-0">
                  <div className="truncate text-zinc-700">{it.description || "—"}</div>
                  <div className="text-zinc-400 tabular-nums">
                    {it.qty} × ฿{baht(it.unitPrice)}
                    {it.vatRate != null && it.vatRate > 0 ? ` · VAT ${it.vatRate}%` : ""}
                  </div>
                </div>
                <span className="shrink-0 tabular-nums font-medium text-zinc-700">฿{baht(it.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ยอดรวม */}
      <div className="rounded-lg bg-zinc-50 px-3 py-2 text-sm ring-1 ring-inset ring-zinc-100">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>ยอดก่อน VAT</span>
          <span className="tabular-nums">฿{baht(bill.subtotal)}</span>
        </div>
        {bill.discount > 0 && (
          <div className="mt-0.5 flex items-center justify-between text-xs text-zinc-500">
            <span>ส่วนลด</span>
            <span className="tabular-nums">−฿{baht(bill.discount)}</span>
          </div>
        )}
        <div className="mt-0.5 flex items-center justify-between text-xs text-zinc-500">
          <span>VAT</span>
          <span className="tabular-nums">฿{baht(bill.vat)}</span>
        </div>
        {bill.wht > 0 && (
          <div className="mt-0.5 flex items-center justify-between text-xs text-amber-600">
            <span>หัก ณ ที่จ่าย</span>
            <span className="tabular-nums">−฿{baht(bill.wht)}</span>
          </div>
        )}
        <div className="mt-1 flex items-center justify-between border-t border-zinc-200 pt-1 text-sm font-semibold text-zinc-900">
          <span>ยอดรวมบิล</span>
          <span className="tabular-nums">฿{baht(bill.total)}</span>
        </div>
      </div>

      {/* เปิดใบเต็ม (แก้ไข/ยืนยัน) */}
      <a
        href={`/ledger/expenses?company=${companyId}&selected=${bill.id}&focus=1`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-brand-600,#2563EB)] hover:underline"
      >
        เปิดใบเต็ม (แก้ไข/ตรวจ) <ExternalLink className="size-3.5" />
      </a>

      {zoom && (
        <Lightbox
          images={bill.images}
          index={imgIdx}
          onClose={() => setZoom(false)}
          onIndex={setImgIdx}
        />
      )}
    </div>
  );
}
